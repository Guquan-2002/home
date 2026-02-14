import test from 'node:test';
import assert from 'node:assert/strict';

import { createApiManager } from '../../js/chat/app/api-manager.js';

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
        startStreaming() {
            streaming = true;
        },
        finishStreaming() {
            streaming = false;
        },
        requestAbort(reason) {
            abortReason = reason;
        },
        setAbortReason(reason) {
            abortReason = reason;
        },
        getAbortReason() {
            return abortReason;
        }
    };
}

function createUi() {
    return {
        addMessage() {},
        addSystemNotice() {},
        addErrorMessage() {},
        setStreamingUI() {},
        showRetryNotice() {},
        showBackupKeyNotice() {},
        addLoadingMessage() {
            return {
                remove() {},
                classList: {
                    remove() {}
                }
            };
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
        provider: 'gemini',
        apiKey: 'key',
        backupApiKey: '',
        model: 'gemini-3-pro-preview',
        enablePseudoStream: false,
        prefixWithTime: false,
        prefixWithName: false,
        userName: 'User',
        ...overrides
    };
}

function createFileReaderMock() {
    return class MockFileReader {
        constructor() {
            this.result = null;
            this.onload = null;
            this.onerror = null;
        }

        readAsDataURL(file) {
            this.result = `data:${file.type};base64,AAAA`;
            if (typeof this.onload === 'function') {
                this.onload();
            }
        }
    };
}

async function attachOneImage(chatInput) {
    await chatInput.dispatch('paste', {
        clipboardData: {
            items: [{
                type: 'image/png',
                getAsFile() {
                    return { type: 'image/png' };
                }
            }]
        },
        preventDefault() {}
    });
}

function getLatestUserMessage(messages) {
    return messages.filter((message) => message.role === 'user').at(-1);
}

test('image-only message injects user-name prefix as first text part', async () => {
    const originalFileReader = globalThis.FileReader;
    globalThis.FileReader = createFileReaderMock();

    try {
        const chatInput = createChatInput();
        const store = createStore();
        const generateCalls = [];
        const provider = {
            id: 'mock-provider',
            async generate(params) {
                generateCalls.push(params);
                return { segments: ['ok'] };
            }
        };

        const manager = createApiManager({
            store,
            elements: createElements(chatInput),
            ui: createUi(),
            configManager: {
                getConfig() {
                    return createConfig({ prefixWithName: true, userName: 'Alice' });
                }
            },
            provider,
            constants: { connectTimeoutMs: 500, maxContextTokens: 200000, maxContextMessages: 120 }
        });

        await attachOneImage(chatInput);
        await manager.sendMessage();

        const userMessage = getLatestUserMessage(store.getActiveMessages());
        assert.equal(userMessage.meta.displayContent, '\u3010Alice\u3011\n已上传 1 张图片');
        assert.equal(userMessage.meta.parts[0].type, 'text');
        assert.equal(userMessage.meta.parts[0].text, '\u3010Alice\u3011');
        assert.equal(userMessage.meta.parts[1].type, 'image');

        const contextMessage = generateCalls[0].localMessageEnvelope.messages[0];
        assert.equal(contextMessage.parts[0].type, 'text');
        assert.equal(contextMessage.parts[0].text, '\u3010Alice\u3011');
    } finally {
        globalThis.FileReader = originalFileReader;
    }
});

test('image-only message with blank userName does not inject prefix text part', async () => {
    const originalFileReader = globalThis.FileReader;
    globalThis.FileReader = createFileReaderMock();

    try {
        const chatInput = createChatInput();
        const store = createStore();
        const provider = {
            id: 'mock-provider',
            async generate() {
                return { segments: ['ok'] };
            }
        };

        const manager = createApiManager({
            store,
            elements: createElements(chatInput),
            ui: createUi(),
            configManager: {
                getConfig() {
                    return createConfig({ prefixWithName: true, userName: '   ' });
                }
            },
            provider,
            constants: { connectTimeoutMs: 500, maxContextTokens: 200000, maxContextMessages: 120 }
        });

        await attachOneImage(chatInput);
        await manager.sendMessage();

        const userMessage = getLatestUserMessage(store.getActiveMessages());
        assert.equal(userMessage.meta.displayContent, '已上传 1 张图片');
        assert.equal(userMessage.meta.parts.length, 1);
        assert.equal(userMessage.meta.parts[0].type, 'image');
    } finally {
        globalThis.FileReader = originalFileReader;
    }
});

test('image-only message with prefixWithName disabled keeps original behavior', async () => {
    const originalFileReader = globalThis.FileReader;
    globalThis.FileReader = createFileReaderMock();

    try {
        const chatInput = createChatInput();
        const store = createStore();
        const provider = {
            id: 'mock-provider',
            async generate() {
                return { segments: ['ok'] };
            }
        };

        const manager = createApiManager({
            store,
            elements: createElements(chatInput),
            ui: createUi(),
            configManager: {
                getConfig() {
                    return createConfig({ prefixWithName: false, userName: 'Alice' });
                }
            },
            provider,
            constants: { connectTimeoutMs: 500, maxContextTokens: 200000, maxContextMessages: 120 }
        });

        await attachOneImage(chatInput);
        await manager.sendMessage();

        const userMessage = getLatestUserMessage(store.getActiveMessages());
        assert.equal(userMessage.meta.displayContent, '已上传 1 张图片');
        assert.equal(userMessage.meta.parts.length, 1);
        assert.equal(userMessage.meta.parts[0].type, 'image');
    } finally {
        globalThis.FileReader = originalFileReader;
    }
});

test('text + image message keeps single text part with prefixed content', async () => {
    const originalFileReader = globalThis.FileReader;
    globalThis.FileReader = createFileReaderMock();

    try {
        const chatInput = createChatInput();
        const store = createStore();
        const provider = {
            id: 'mock-provider',
            async generate() {
                return { segments: ['ok'] };
            }
        };

        const manager = createApiManager({
            store,
            elements: createElements(chatInput),
            ui: createUi(),
            configManager: {
                getConfig() {
                    return createConfig({ prefixWithName: true, userName: 'Alice' });
                }
            },
            provider,
            constants: { connectTimeoutMs: 500, maxContextTokens: 200000, maxContextMessages: 120 }
        });

        await attachOneImage(chatInput);
        chatInput.value = 'hello';
        await manager.sendMessage();

        const userMessage = getLatestUserMessage(store.getActiveMessages());
        assert.equal(userMessage.meta.displayContent, '\u3010Alice\u3011\nhello');
        assert.equal(userMessage.meta.parts.length, 2);
        assert.equal(userMessage.meta.parts[0].type, 'text');
        assert.equal(userMessage.meta.parts[0].text, '\u3010Alice\u3011\nhello');
        assert.equal(userMessage.meta.parts[1].type, 'image');
    } finally {
        globalThis.FileReader = originalFileReader;
    }
});

test('openai web search uses streaming path with ping events clearing timeout', async () => {
    const chatInput = createChatInput();
    const store = createStore();
    let generateCount = 0;
    let generateStreamCount = 0;
    const provider = {
        id: 'mock-provider',
        async generate() {
            generateCount += 1;
            return { segments: ['ok'] };
        },
        async *generateStream() {
            generateStreamCount += 1;
            yield { type: 'ping' };
            yield { type: 'text-delta', text: 'stream' };
            yield { type: 'done' };
        }
    };

    const manager = createApiManager({
        store,
        elements: createElements(chatInput),
        ui: createUi(),
        configManager: {
            getConfig() {
                return createConfig({
                    provider: 'openai_responses',
                    searchMode: 'openai_web_search',
                    enablePseudoStream: true
                });
            }
        },
        provider,
        constants: { connectTimeoutMs: 500, maxContextTokens: 200000, maxContextMessages: 120 }
    });

    chatInput.value = 'search today gold price';
    await manager.sendMessage();

    assert.equal(generateCount, 0);
    assert.equal(generateStreamCount, 1);
});

test('request failure includes provider diagnostics in error detail', async () => {
    const chatInput = createChatInput();
    const store = createStore();
    const errorPayloads = [];
    const provider = {
        id: 'mock-provider',
        async generate() {
            throw new Error('HTTP 400: Invalid web_search request');
        }
    };

    const ui = createUi();
    ui.addErrorMessage = (payload) => {
        errorPayloads.push(payload);
    };

    const manager = createApiManager({
        store,
        elements: createElements(chatInput),
        ui,
        configManager: {
            getConfig() {
                return createConfig({
                    provider: 'openai_responses',
                    apiUrl: 'https://api.openai.com/v1',
                    searchMode: 'openai_web_search',
                    enablePseudoStream: false
                });
            }
        },
        provider,
        constants: { connectTimeoutMs: 500, maxContextTokens: 200000, maxContextMessages: 120 }
    });

    chatInput.value = 'check gold price';
    await manager.sendMessage();

    assert.equal(errorPayloads.length, 1);
    const detail = errorPayloads[0].detail || '';
    assert.equal(errorPayloads[0].title, 'Request failed');
    assert.equal(detail.includes('Provider=openai_responses'), true);
    assert.equal(detail.includes('Endpoint=https://api.openai.com/v1/responses'), true);
    assert.equal(detail.includes('SearchMode=openai_web_search'), true);
    assert.equal(detail.includes('TimeoutMs=500'), true);
    assert.equal(detail.includes('Error=HTTP 400: Invalid web_search request'), true);
});
