import test from 'node:test';
import assert from 'node:assert/strict';

import { createApiManager } from '../../js/chat/app/api-manager.js';
import { ASSISTANT_SEGMENT_MARKER, ASSISTANT_SENTENCE_MARKER } from '../../js/chat/constants.js';

function createChatInput() {
    const listeners = new Map();
    return {
        value: '',
        style: {},
        scrollHeight: 20,
        addEventListener(type, handler) {
            listeners.set(type, handler);
        },
        async dispatch(type, event) {
            const handler = listeners.get(type);
            if (handler) {
                return handler(event);
            }
            return undefined;
        },
        focus() {}
    };
}

function createStore() {
    const messages = [];
    let streaming = false;
    let abortController = null;
    let abortReason = '';

    return {
        appendMessages(nextMessages) {
            messages.push(...nextMessages);
        },
        getActiveMessages() {
            return [...messages];
        },
        getActiveSessionId() {
            return 'session_1';
        },
        isStreaming() {
            return streaming;
        },
        startStreaming(controller) {
            streaming = true;
            abortController = controller;
            abortReason = '';
        },
        finishStreaming() {
            streaming = false;
            abortController = null;
            abortReason = '';
        },
        requestAbort(reason = 'user') {
            if (!abortController) {
                return false;
            }

            abortReason = reason;
            abortController.abort();
            return true;
        },
        setAbortReason(reason) {
            abortReason = reason;
        },
        getAbortReason() {
            return abortReason;
        }
    };
}

function createUiSpy() {
    let nextStreamElementId = 1;
    const state = {
        loadingCalls: 0,
        loadingRemoved: 0,
        streamingCreates: [],
        streamingUpdates: [],
        streamingFinalizations: [],
        removedStreamElements: [],
        notices: [],
        errors: [],
        trace: []
    };

    function createStreamElement(id) {
        let removed = false;
        return {
            id,
            textContent: '',
            remove() {
                if (removed) {
                    return;
                }
                removed = true;
                state.removedStreamElements.push(id);
            }
        };
    }

    return {
        state,
        ui: {
            addMessage() {},
            addSystemNotice(text) {
                state.notices.push(text);
            },
            addErrorMessage(payload) {
                state.errors.push(payload);
            },
            setStreamingUI() {},
            showRetryNotice() {},
            showBackupKeyNotice() {},
            addLoadingMessage() {
                state.loadingCalls += 1;
                return {
                    remove() {
                        state.loadingRemoved += 1;
                    },
                    classList: {
                        remove() {}
                    }
                };
            },
            createAssistantStreamingMessage(_identifiers = {}, options = {}) {
                const id = nextStreamElementId;
                nextStreamElementId += 1;
                const element = createStreamElement(id);
                element.textContent = typeof options?.initialText === 'string' ? options.initialText : '';
                state.streamingCreates.push({
                    id,
                    options: {
                        initialText: options?.initialText || '',
                        placeholder: options?.placeholder === true
                    }
                });
                state.trace.push(`ui:create:${options?.placeholder === true ? 'placeholder' : 'regular'}`);
                return element;
            },
            updateAssistantStreamingMessage(messageElement, text) {
                if (messageElement) {
                    messageElement.textContent = text;
                }
                state.streamingUpdates.push({
                    id: messageElement?.id || null,
                    text
                });
            },
            finalizeAssistantStreamingMessage(messageElement, text) {
                if (messageElement) {
                    messageElement.textContent = text;
                }
                state.streamingFinalizations.push({
                    id: messageElement?.id || null,
                    text
                });
            }
        }
    };
}

function createElements(chatInput) {
    return {
        chatInput,
        settingsDiv: {
            classList: {
                remove() {}
            }
        }
    };
}

function createConfig(overrides = {}) {
    return {
        provider: 'openai',
        apiKey: 'key',
        backupApiKey: '',
        apiUrl: 'https://api.openai.com/v1',
        model: 'gpt-5',
        enablePseudoStream: true,
        prefixWithTime: false,
        prefixWithName: false,
        userName: 'User',
        ...overrides
    };
}

function createManager({
    provider,
    configOverrides = {}
} = {}) {
    const chatInput = createChatInput();
    const store = createStore();
    const { ui, state } = createUiSpy();

    const manager = createApiManager({
        store,
        elements: createElements(chatInput),
        ui,
        configManager: {
            getConfig() {
                return createConfig(configOverrides);
            }
        },
        provider,
        constants: { connectTimeoutMs: 500, maxContextTokens: 200000, maxContextMessages: 120 }
    });

    return {
        manager,
        chatInput,
        store,
        uiState: state
    };
}

function getAssistantContents(messages) {
    return messages
        .filter((message) => message.role === 'assistant')
        .map((message) => message.content);
}

function createAbortError() {
    const error = new Error('Aborted');
    error.name = 'AbortError';
    return error;
}

async function waitFor(predicate, timeoutMs = 500) {
    const startedAt = Date.now();
    while (!predicate()) {
        if (Date.now() - startedAt > timeoutMs) {
            throw new Error('Timed out waiting for condition.');
        }
        await new Promise((resolve) => setTimeout(resolve, 5));
    }
}

test('pseudo stream mode does not create dot-loading bubble', async () => {
    const provider = {
        id: 'mock-provider',
        async generate() {
            return { segments: [] };
        },
        async *generateStream() {
            yield { type: 'ping' };
            yield { type: 'done' };
        }
    };

    const { manager, chatInput, uiState } = createManager({ provider });
    chatInput.value = 'hello';
    await manager.sendMessage();

    assert.equal(uiState.loadingCalls, 0);
    assert.equal(uiState.errors.length, 0);
});

test('streaming placeholder is created only after first text-delta', async () => {
    let sharedTrace = null;
    const provider = {
        id: 'mock-provider',
        async generate() {
            return { segments: [] };
        },
        async *generateStream() {
            sharedTrace.push('emit:ping');
            yield { type: 'ping' };
            sharedTrace.push('emit:text');
            yield { type: 'text-delta', text: 'hello' };
            sharedTrace.push('emit:done');
            yield { type: 'done' };
        }
    };

    const { manager, chatInput, store, uiState } = createManager({ provider });
    sharedTrace = uiState.trace;
    chatInput.value = 'hello';
    await manager.sendMessage();

    const firstCreateIndex = uiState.trace.findIndex((entry) => entry.startsWith('ui:create:'));
    assert.equal(firstCreateIndex > uiState.trace.indexOf('emit:text'), true);
    assert.equal(firstCreateIndex > uiState.trace.indexOf('emit:ping'), true);
    assert.equal(uiState.streamingCreates.length, 1);
    assert.deepEqual(getAssistantContents(store.getActiveMessages()), ['hello']);
});

test('reasoning event can trigger placeholder before first text-delta', async () => {
    let sharedTrace = null;
    const provider = {
        id: 'mock-provider',
        async generate() {
            return { segments: [] };
        },
        async *generateStream() {
            sharedTrace.push('emit:reasoning');
            yield { type: 'reasoning' };
            sharedTrace.push('emit:text');
            yield { type: 'text-delta', text: 'hello' };
            sharedTrace.push('emit:done');
            yield { type: 'done' };
        }
    };

    const { manager, chatInput, store, uiState } = createManager({ provider });
    sharedTrace = uiState.trace;
    chatInput.value = 'hello';
    await manager.sendMessage();

    const firstCreateIndex = uiState.trace.findIndex((entry) => entry.startsWith('ui:create:'));
    assert.equal(firstCreateIndex > uiState.trace.indexOf('emit:reasoning'), true);
    assert.equal(firstCreateIndex < uiState.trace.indexOf('emit:text'), true);
    assert.equal(uiState.streamingCreates.length, 1);
    assert.deepEqual(getAssistantContents(store.getActiveMessages()), ['hello']);
});

test('marker split finalizes current placeholder and persists completed segment', async () => {
    const provider = {
        id: 'mock-provider',
        async generate() {
            return { segments: [] };
        },
        async *generateStream() {
            yield { type: 'text-delta', text: `Hello${ASSISTANT_SENTENCE_MARKER}` };
            yield { type: 'done' };
        }
    };

    const { manager, chatInput, store, uiState } = createManager({ provider });
    chatInput.value = 'hello';
    await manager.sendMessage();

    assert.deepEqual(getAssistantContents(store.getActiveMessages()), ['Hello']);
    assert.equal(uiState.streamingCreates.length, 2);
    assert.equal(uiState.streamingFinalizations.length, 1);
    assert.equal(uiState.streamingFinalizations[0].text, 'Hello');
    assert.equal(uiState.streamingFinalizations[0].id, uiState.streamingCreates[0].id);
    assert.equal(uiState.removedStreamElements.includes(uiState.streamingCreates[1].id), true);
});

test('multiple markers create multiple finalized assistant bubbles in order', async () => {
    const provider = {
        id: 'mock-provider',
        async generate() {
            return { segments: [] };
        },
        async *generateStream() {
            yield {
                type: 'text-delta',
                text: `A${ASSISTANT_SENTENCE_MARKER}B${ASSISTANT_SEGMENT_MARKER}C`
            };
            yield { type: 'done' };
        }
    };

    const { manager, chatInput, store, uiState } = createManager({ provider });
    chatInput.value = 'hello';
    await manager.sendMessage();

    assert.deepEqual(getAssistantContents(store.getActiveMessages()), ['A', 'B', 'C']);
    assert.deepEqual(
        uiState.streamingFinalizations.map((item) => item.text),
        ['A', 'B', 'C']
    );
    assert.equal(uiState.loadingCalls, 0);
});

test('user abort discards unmarked partial content and removes placeholder', async () => {
    const provider = {
        id: 'mock-provider',
        async generate() {
            return { segments: [] };
        },
        async *generateStream({ signal }) {
            yield { type: 'text-delta', text: 'partial-without-marker' };
            while (!signal.aborted) {
                await new Promise((resolve) => setTimeout(resolve, 5));
            }
            throw createAbortError();
        }
    };

    const { manager, chatInput, store, uiState } = createManager({ provider });
    chatInput.value = 'hello';

    const sending = manager.sendMessage();
    await waitFor(() => uiState.streamingCreates.length > 0);
    manager.stopGeneration();
    await sending;

    assert.deepEqual(getAssistantContents(store.getActiveMessages()), []);
    assert.equal(uiState.removedStreamElements.length > 0, true);
    assert.equal(
        uiState.notices.includes('Generation stopped. Unmarked partial content was discarded.'),
        true
    );
});

test('stream failure before first delta falls back silently to non-streaming response', async () => {
    let sharedTrace = null;
    let streamAttempts = 0;
    let nonStreamAttempts = 0;
    const provider = {
        id: 'mock-provider',
        async generate() {
            nonStreamAttempts += 1;
            sharedTrace.push('provider:generate');
            return { segments: ['fallback-answer'] };
        },
        async *generateStream() {
            streamAttempts += 1;
            sharedTrace.push('provider:generateStream');
            throw new Error('stream unavailable');
        }
    };

    const { manager, chatInput, store, uiState } = createManager({ provider });
    sharedTrace = uiState.trace;
    chatInput.value = 'hello';
    await manager.sendMessage();

    assert.equal(streamAttempts, 1);
    assert.equal(nonStreamAttempts, 1);
    assert.equal(uiState.loadingCalls, 0);
    assert.equal(uiState.streamingCreates.some((item) => item.options.placeholder), false);
    assert.deepEqual(getAssistantContents(store.getActiveMessages()), ['fallback-answer']);
    assert.equal(
        uiState.trace.indexOf('provider:generate') < uiState.trace.findIndex((entry) => entry.startsWith('ui:create:')),
        true
    );
});
