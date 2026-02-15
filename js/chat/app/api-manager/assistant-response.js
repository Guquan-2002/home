/**
 * API manager assistant response orchestration.
 *
 * Responsibility:
 * - Build context envelope and call provider response APIs
 * - Coordinate streaming/non-streaming rendering behavior
 * - Handle fallback, timeout, abort, and error UI flows
 */
import { buildLocalMessageEnvelope } from '../../core/context-window.js';
import { createChatMessage, getMessageDisplayContent } from '../../core/message-model.js';
import { createMarkerStreamSplitter } from '../../core/marker-stream-splitter.js';
import { ASSISTANT_SEGMENT_MARKER, ASSISTANT_SENTENCE_MARKER } from '../../constants.js';
import { runPseudoStream } from '../../core/pseudo-stream.js';
import {
    buildRequestDiagnosticDetail,
    logContextWindowDebug,
    resolveConnectTimeoutMs,
    resolveContextMaxMessages,
    resolveRequestEndpoint
} from './diagnostics.js';

const ASSISTANT_STREAMING_PLACEHOLDER_TEXT = '正在输入中……';

function resizeInputToContent(chatInput) {
    chatInput.style.height = 'auto';
    chatInput.style.height = `${Math.min(chatInput.scrollHeight, 120)}px`;
}

export function createAssistantResponseManager({
    store,
    ui,
    providerClient,
    constants,
    chatInput,
    onConversationUpdated = null
}) {
    const {
        connectTimeoutMs,
        maxContextTokens = 200000,
        maxContextMessages = 120
    } = constants;

    let contextTrimNoticeShown = false;

    function notifyConversationUpdated() {
        if (typeof onConversationUpdated === 'function') {
            onConversationUpdated();
        }
    }

    function notifyContextTrim(isTrimmed) {
        if (!isTrimmed) {
            contextTrimNoticeShown = false;
            return;
        }

        if (contextTrimNoticeShown) {
            return;
        }

        ui.addSystemNotice('Older messages were excluded from model context due to token limits.', 3500);
        contextTrimNoticeShown = true;
    }

    function appendMessagesToUi(messages) {
        messages.forEach((message) => {
            ui.addMessage(message.role, getMessageDisplayContent(message), message.meta, {
                messageId: message.id,
                turnId: message.turnId
            });
        });
    }

    function refillFailedInput(text) {
        chatInput.value = typeof text === 'string' ? text : '';
        resizeInputToContent(chatInput);
        chatInput.focus();
    }

    function showFailureMessage(title, detail, failedInputText) {
        ui.addErrorMessage({
            title,
            detail,
            actionLabel: failedInputText ? 'Retry' : '',
            onAction: failedInputText
                ? () => refillFailedInput(failedInputText)
                : null
        });
    }

    async function renderAssistantSegments(segments, turnId, config, signal) {
        const createdAt = Date.now();
        const assistantMessages = [];
        let interrupted = false;

        for (let index = 0; index < segments.length; index += 1) {
            const segment = segments[index];
            const segmentCreatedAt = createdAt + index;

            if (!config.enablePseudoStream) {
                const message = createChatMessage({
                    role: 'assistant',
                    content: segment,
                    turnId,
                    metaOptions: {
                        createdAt: segmentCreatedAt
                    }
                });
                assistantMessages.push(message);
                continue;
            }

            const streamMessageEl = ui.createAssistantStreamingMessage();
            const streamResult = await runPseudoStream({
                text: segment,
                signal,
                baseDelayMs: 20,
                onProgress: (nextText) => {
                    ui.updateAssistantStreamingMessage(streamMessageEl, nextText);
                }
            });

            ui.finalizeAssistantStreamingMessage(streamMessageEl, streamResult.renderedText, {
                interrupted: streamResult.interrupted
            });

            if (streamResult.renderedText) {
                assistantMessages.push(createChatMessage({
                    role: 'assistant',
                    content: streamResult.renderedText,
                    turnId,
                    metaOptions: {
                        createdAt: segmentCreatedAt,
                        interrupted: streamResult.interrupted
                    }
                }));
            }

            if (streamResult.interrupted) {
                interrupted = true;
                break;
            }
        }

        if (!config.enablePseudoStream && assistantMessages.length > 0) {
            appendMessagesToUi(assistantMessages);
        }

        return {
            assistantMessages,
            interrupted
        };
    }

    async function generateAssistantResponse(config, turnId, failedInputText) {
        const requestSessionId = store.getActiveSessionId();
        const effectiveMaxContextMessages = resolveContextMaxMessages(maxContextMessages);
        const shouldUseStreaming = config.enablePseudoStream
            && typeof providerClient.generateStream === 'function';
        const requestConnectTimeoutMs = resolveConnectTimeoutMs(connectTimeoutMs);
        const contextWindow = buildLocalMessageEnvelope(
            store.getActiveMessages(),
            config,
            {
                maxContextTokens,
                maxContextMessages: effectiveMaxContextMessages
            }
        );

        notifyContextTrim(contextWindow.isTrimmed);
        logContextWindowDebug(contextWindow, config);

        const loadingMessage = config.enablePseudoStream === true
            ? null
            : ui.addLoadingMessage();
        let loadingMessageRemoved = false;
        const removeLoadingMessage = () => {
            if (!loadingMessage || loadingMessageRemoved) {
                return;
            }

            loadingMessageRemoved = true;
            loadingMessage.remove();
        };

        const abortController = new AbortController();
        store.startStreaming(abortController);
        ui.setStreamingUI(true);

        const timeoutId = setTimeout(() => {
            if (!store.isStreaming()) {
                return;
            }

            store.setAbortReason('connect_timeout');
            abortController.abort();
        }, requestConnectTimeoutMs);

        let timeoutCleared = false;
        const clearConnectionTimeout = () => {
            if (timeoutCleared) {
                return;
            }

            clearTimeout(timeoutId);
            timeoutCleared = true;
        };

        const streamState = {
            splitter: null,
            persistedSegmentCount: 0,
            activeStreamingMessageEl: null
        };
        const dropStreamingPlaceholder = () => {
            const messageElement = streamState.activeStreamingMessageEl;
            if (messageElement?.remove) {
                messageElement.remove();
            }
            streamState.activeStreamingMessageEl = null;
        };
        let activeRequestEndpoint = '';
        let activeRequestUsesStreaming = false;

        const consumeNonStreamingResponse = async () => {
            activeRequestEndpoint = resolveRequestEndpoint(config, false);
            activeRequestUsesStreaming = false;
            const response = await providerClient.generate({
                config,
                contextMessages: contextWindow.messages,
                localMessageEnvelope: contextWindow,
                signal: abortController.signal,
                onRetryNotice: (attempt, maxRetries, delayMs) => {
                    ui.showRetryNotice(attempt, maxRetries, delayMs);
                },
                onFallbackKey: () => {
                    ui.showBackupKeyNotice();
                }
            });

            if (store.getActiveSessionId() !== requestSessionId) {
                removeLoadingMessage();
                return;
            }

            clearConnectionTimeout();
            removeLoadingMessage();

            const renderResult = await renderAssistantSegments(
                response.segments,
                turnId,
                config,
                abortController.signal
            );

            if (renderResult.assistantMessages.length > 0) {
                store.appendMessages(renderResult.assistantMessages);
                notifyConversationUpdated();
            }

            if (renderResult.interrupted) {
                ui.addSystemNotice('Generation stopped by user. Partial response kept.', 3200);
            }
        };

        const consumeStreamingResponse = async () => {
            activeRequestEndpoint = resolveRequestEndpoint(config, true);
            activeRequestUsesStreaming = true;
            streamState.splitter = createMarkerStreamSplitter({
                markers: [ASSISTANT_SEGMENT_MARKER, ASSISTANT_SENTENCE_MARKER]
            });

            let segmentIndex = 0;
            const ensureStreamingPlaceholder = () => {
                if (streamState.activeStreamingMessageEl) {
                    return streamState.activeStreamingMessageEl;
                }

                const messageElement = ui.createAssistantStreamingMessage({}, {
                    initialText: ASSISTANT_STREAMING_PLACEHOLDER_TEXT,
                    placeholder: true
                });
                streamState.activeStreamingMessageEl = messageElement;
                return messageElement;
            };
            const finalizeStreamingSegment = (segment, createdAt) => {
                const trimmedSegment = typeof segment === 'string' ? segment.trim() : '';
                if (!trimmedSegment) {
                    return false;
                }

                const messageElement = streamState.activeStreamingMessageEl || ensureStreamingPlaceholder();
                ui.finalizeAssistantStreamingMessage(messageElement, trimmedSegment);
                streamState.activeStreamingMessageEl = null;

                const message = createChatMessage({
                    role: 'assistant',
                    content: trimmedSegment,
                    turnId,
                    metaOptions: {
                        createdAt
                    }
                });
                store.appendMessages([message]);
                streamState.persistedSegmentCount += 1;
                return true;
            };
            const stream = providerClient.generateStream({
                config,
                contextMessages: contextWindow.messages,
                localMessageEnvelope: contextWindow,
                signal: abortController.signal,
                onRetryNotice: (attempt, maxRetries, delayMs) => {
                    ui.showRetryNotice(attempt, maxRetries, delayMs);
                },
                onFallbackKey: () => {
                    ui.showBackupKeyNotice();
                }
            });

            for await (const event of stream) {
                if (store.getActiveSessionId() !== requestSessionId) {
                    removeLoadingMessage();
                    dropStreamingPlaceholder();
                    return;
                }

                // Any SSE event means the connection is established; avoid false timeout on tool events.
                clearConnectionTimeout();
                removeLoadingMessage();

                if (event?.type === 'reasoning') {
                    ensureStreamingPlaceholder();
                    continue;
                }

                if (event?.type !== 'text-delta' || typeof event?.text !== 'string' || !event.text) {
                    continue;
                }

                ensureStreamingPlaceholder();
                const completedSegments = streamState.splitter.push(event.text);
                for (const segment of completedSegments) {
                    if (finalizeStreamingSegment(segment, Date.now() + segmentIndex)) {
                        segmentIndex += 1;
                    }
                }

                if (completedSegments.length > 0) {
                    ensureStreamingPlaceholder();
                }
            }

            removeLoadingMessage();
            clearConnectionTimeout();

            const lastSegment = streamState.splitter.flush();
            if (lastSegment) {
                finalizeStreamingSegment(lastSegment, Date.now() + segmentIndex);
            } else {
                dropStreamingPlaceholder();
            }
        };

        try {
            if (shouldUseStreaming) {
                await consumeStreamingResponse();
            } else {
                await consumeNonStreamingResponse();
            }
        } catch (rawError) {
            let error = rawError;

            if (store.getActiveSessionId() !== requestSessionId) {
                removeLoadingMessage();
                dropStreamingPlaceholder();
                return;
            }

            const shouldFallbackToNonStreaming = shouldUseStreaming
                && streamState.persistedSegmentCount === 0
                && error?.name !== 'AbortError';

            if (shouldFallbackToNonStreaming) {
                streamState.splitter?.discardRemainder();
                dropStreamingPlaceholder();
                try {
                    await consumeNonStreamingResponse();
                    return;
                } catch (fallbackError) {
                    error = fallbackError;
                }
            }

            if (error?.name === 'AbortError') {
                const abortReason = store.getAbortReason();
                removeLoadingMessage();
                dropStreamingPlaceholder();

                if (abortReason === 'connect_timeout') {
                    const detail = buildRequestDiagnosticDetail(config, {
                        endpoint: activeRequestEndpoint,
                        useStreaming: activeRequestUsesStreaming,
                        timeoutMs: requestConnectTimeoutMs,
                        errorDetail: 'Connection timed out before the first response chunk.'
                    });
                    showFailureMessage('Connection timeout', detail, failedInputText);
                } else if (abortReason === 'user') {
                    if (shouldUseStreaming) {
                        streamState.splitter?.discardRemainder();
                        ui.addSystemNotice('Generation stopped. Unmarked partial content was discarded.', 3200);
                    } else {
                        ui.addSystemNotice('Generation stopped by user.');
                    }
                }
            } else {
                removeLoadingMessage();
                dropStreamingPlaceholder();
                const detail = buildRequestDiagnosticDetail(config, {
                    endpoint: activeRequestEndpoint,
                    useStreaming: activeRequestUsesStreaming,
                    timeoutMs: requestConnectTimeoutMs,
                    errorDetail: error?.message || 'Unknown error'
                });
                showFailureMessage('Request failed', detail, failedInputText);
            }
        } finally {
            if (!timeoutCleared) {
                clearTimeout(timeoutId);
            }

            if (shouldUseStreaming
                && streamState.persistedSegmentCount > 0
                && store.getActiveSessionId() === requestSessionId) {
                notifyConversationUpdated();
            }
            dropStreamingPlaceholder();
            loadingMessage?.classList?.remove('typing');
            store.finishStreaming();
            ui.setStreamingUI(false);
            chatInput.focus();
        }
    }

    return {
        generateAssistantResponse
    };
}

