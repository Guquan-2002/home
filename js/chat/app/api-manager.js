/**
 * 聊天 API 管理器
 *
 * 职责：
 * - 协调发送、流式输出与中止流程（UI、状态、Provider 之间）
 * - 处理用户消息输入（文本、图片附件）
 * - 构建上下文窗口并调用 AI Provider
 * - 管理流式响应和伪流式渲染
 * - 处理错误、重试、超时、备用密钥切换
 * - 提供重试能力（回填到指定轮次）
 * - 输出上下文窗口调试信息（可选）
 *
 * 依赖：context-window, message-model, marker-stream-splitter, prefix, pseudo-stream, provider-interface
 * 被依赖：chat.js
 */
import { buildContextPreview, buildLocalMessageEnvelope, normalizeMaxContextMessages } from '../core/context-window.js';
import { createChatMessage, createTurnId, getMessageDisplayContent } from '../core/message-model.js';
import { createMarkerStreamSplitter } from '../core/marker-stream-splitter.js';
import { applyMessagePrefix, buildMessagePrefix, buildTimestampPrefix } from '../core/prefix.js';
import { ASSISTANT_SEGMENT_MARKER, ASSISTANT_SENTENCE_MARKER } from '../constants.js';
import { runPseudoStream } from '../core/pseudo-stream.js';
import { assertProvider } from '../providers/provider-interface.js';

// 上下文调试相关常量
const CONTEXT_DEBUG_STORAGE_KEY = 'llm_chat_context_debug';
const CONTEXT_MAX_MESSAGES_STORAGE_KEY = 'llm_chat_context_max_messages';
const CONTEXT_DEBUG_PREVIEW_CHARS = 80;
const ASSISTANT_STREAMING_PLACEHOLDER_TEXT = '正在输入中……';

function asTrimmedString(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function normalizeApiUrl(apiUrl) {
    const trimmed = asTrimmedString(apiUrl).replace(/\/+$/, '');
    return trimmed || '';
}

function appendEndpointPath(baseUrl, pathSuffix) {
    if (!baseUrl) {
        return '(missing apiUrl)';
    }

    return baseUrl.endsWith(pathSuffix) ? baseUrl : `${baseUrl}${pathSuffix}`;
}

function resolveRequestEndpoint(config, useStreaming) {
    const providerId = asTrimmedString(config?.provider);
    const baseUrl = normalizeApiUrl(config?.apiUrl);

    if (providerId === 'openai') {
        return appendEndpointPath(baseUrl, '/chat/completions');
    }

    if (providerId === 'openai_responses' || providerId === 'ark_responses') {
        return appendEndpointPath(baseUrl, '/responses');
    }

    if (providerId === 'anthropic') {
        return appendEndpointPath(baseUrl, '/messages');
    }

    if (providerId === 'gemini') {
        const model = asTrimmedString(config?.model);
        if (!baseUrl || !model) {
            return baseUrl || '(missing apiUrl)';
        }

        const endpointSuffix = useStreaming
            ? `:streamGenerateContent?alt=sse`
            : ':generateContent';
        return `${baseUrl}/models/${encodeURIComponent(model)}${endpointSuffix}`;
    }

    return baseUrl || '(unknown endpoint)';
}

function buildRequestDiagnosticDetail(config, {
    endpoint = '',
    useStreaming = false,
    timeoutMs = 30000,
    errorDetail = ''
} = {}) {
    const providerId = asTrimmedString(config?.provider) || '(unknown)';
    const searchMode = asTrimmedString(config?.searchMode) || '(disabled)';
    const resolvedEndpoint = endpoint || resolveRequestEndpoint(config, useStreaming);
    const details = [
        `Provider=${providerId}`,
        `Endpoint=${resolvedEndpoint}`,
        `SearchMode=${searchMode}`,
        `Streaming=${useStreaming ? 'true' : 'false'}`,
        `TimeoutMs=${timeoutMs}`
    ];

    const normalizedError = asTrimmedString(errorDetail);
    if (normalizedError) {
        details.push(`Error=${normalizedError}`);
    }

    return details.join(' | ');
}

/**
 * 检查是否启用上下文调试
 *
 * 调试模式可通过以下方式启用：
 * 1. 全局变量：window.__CHAT_CONTEXT_DEBUG__ = true
 * 2. localStorage：llm_chat_context_debug = '1'
 */
function isContextDebugEnabled() {
    if (globalThis.__CHAT_CONTEXT_DEBUG__ === true) {
        return true;
    }

    if (typeof localStorage === 'undefined') {
        return false;
    }

    try {
        return localStorage.getItem(CONTEXT_DEBUG_STORAGE_KEY) === '1';
    } catch {
        return false;
    }
}

/**
 * 解析上下文最大消息数
 *
 * 优先级：
 * 1. 全局变量：window.__CHAT_CONTEXT_MAX_MESSAGES__
 * 2. localStorage：llm_chat_context_max_messages
 * 3. 默认值
 */
function resolveContextMaxMessages(defaultValue) {
    const globalOverride = normalizeMaxContextMessages(globalThis.__CHAT_CONTEXT_MAX_MESSAGES__);
    if (globalOverride) {
        return globalOverride;
    }

    if (typeof localStorage !== 'undefined') {
        try {
            const localOverride = normalizeMaxContextMessages(localStorage.getItem(CONTEXT_MAX_MESSAGES_STORAGE_KEY));
            if (localOverride) {
                return localOverride;
            }
        } catch {
            // Ignore localStorage read failures.
        }
    }

    return normalizeMaxContextMessages(defaultValue);
}

function resolveConnectTimeoutMs(defaultTimeoutMs) {
    return Number.isFinite(defaultTimeoutMs) && defaultTimeoutMs > 0
        ? defaultTimeoutMs
        : 30000;
}

/**
 * 输出上下文窗口调试信息
 *
 * 包含：
 * - Provider 和模型信息
 * - 消息数量统计（总数、用户消息、助手消息）
 * - Token 数量和预算
 * - 是否被裁剪
 * - 消息预览
 */
function logContextWindowDebug(contextWindow, config) {
    if (!isContextDebugEnabled()) {
        return;
    }

    const userMessageCount = contextWindow.messages.filter((message) => message.role === 'user').length;
    const assistantMessageCount = contextWindow.messages.length - userMessageCount;

    console.info('[ChatContext]', {
        provider: config.provider,
        model: config.model,
        totalMessages: contextWindow.messages.length,
        userMessages: userMessageCount,
        assistantMessages: assistantMessageCount,
        tokenCount: contextWindow.tokenCount,
        inputBudgetTokens: contextWindow.inputBudgetTokens,
        maxContextMessages: contextWindow.maxContextMessages,
        trimmed: contextWindow.isTrimmed,
        preview: buildContextPreview(contextWindow.messages, CONTEXT_DEBUG_PREVIEW_CHARS)
    });
}

function resizeInputToContent(chatInput) {
    chatInput.style.height = 'auto';
    chatInput.style.height = `${Math.min(chatInput.scrollHeight, 120)}px`;
}

function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
        reader.onerror = () => reject(new Error('Failed to read image file.'));
        reader.readAsDataURL(file);
    });
}

function formatAttachmentNotice(count) {
    return count === 1 ? '已上传 1 张图片' : `已上传 ${count} 张图片`;
}

export function createApiManager({
    store,
    elements,
    ui,
    configManager,
    provider,
    constants,
    onConversationUpdated = null,
    onUserMessageAccepted = null
}) {
    const providerClient = assertProvider(provider);

    const {
        chatInput,
        attachBtn = null,
        imageInput = null,
        attachmentsEl = null,
        settingsDiv
    } = elements;
    const {
        connectTimeoutMs,
        maxContextTokens = 200000,
        maxContextMessages = 120
    } = constants;

    let contextTrimNoticeShown = false;
    let pendingImageParts = [];

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

    function appendAssistantSegmentImmediate(segment, turnId, createdAt) {
        const trimmedSegment = typeof segment === 'string' ? segment.trim() : '';
        if (!trimmedSegment) {
            return null;
        }

        const message = createChatMessage({
            role: 'assistant',
            content: trimmedSegment,
            turnId,
            metaOptions: {
                createdAt
            }
        });

        store.appendMessages([message]);
        appendMessagesToUi([message]);
        notifyConversationUpdated();
        return message;
    }

    function updateAttachmentButtonState() {
        if (!attachBtn) {
            return;
        }

        attachBtn.classList.toggle('has-attachments', pendingImageParts.length > 0);
        attachBtn.title = pendingImageParts.length > 0
            ? formatAttachmentNotice(pendingImageParts.length)
            : 'Attach images';
    }

    function renderAttachmentPreview() {
        if (!attachmentsEl) {
            updateAttachmentButtonState();
            return;
        }

        attachmentsEl.innerHTML = '';
        pendingImageParts.forEach((part, index) => {
            const chip = document.createElement('div');
            chip.className = 'chat-attachment-chip';

            const image = document.createElement('img');
            image.src = part.image.value;
            image.alt = `attachment-${index + 1}`;
            chip.appendChild(image);

            const removeBtn = document.createElement('button');
            removeBtn.type = 'button';
            removeBtn.className = 'chat-attachment-remove';
            removeBtn.textContent = '锟斤拷';
            removeBtn.title = 'Remove image';
            removeBtn.addEventListener('click', () => {
                pendingImageParts = pendingImageParts.filter((_, i) => i !== index);
                renderAttachmentPreview();
            });
            chip.appendChild(removeBtn);

            attachmentsEl.appendChild(chip);
        });

        updateAttachmentButtonState();
    }

    function clearPendingImages() {
        pendingImageParts = [];
        if (imageInput) {
            imageInput.value = '';
        }
        renderAttachmentPreview();
    }

    async function appendImageFiles(files) {
        if (!Array.isArray(files) || files.length === 0) {
            return;
        }

        const nextParts = [];
        for (const file of files) {
            if (!file || typeof file.type !== 'string' || !file.type.startsWith('image/')) {
                continue;
            }

            const dataUrl = await fileToDataUrl(file);
            if (!dataUrl) {
                continue;
            }

            nextParts.push({
                type: 'image',
                image: {
                    sourceType: 'data_url',
                    value: dataUrl,
                    mimeType: file.type
                }
            });
        }

        if (nextParts.length === 0) {
            return;
        }

        pendingImageParts = [...pendingImageParts, ...nextParts];
        renderAttachmentPreview();
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

    async function sendMessage() {
        const text = chatInput.value.trim();
        if (store.isStreaming()) {
            return;
        }

        const hasImages = pendingImageParts.length > 0;
        if (!text && !hasImages) {
            return;
        }

        const config = configManager.getConfig();
        const providerLabelMap = {
            gemini: 'Gemini',
            openai: 'OpenAI Chat Completions',
            openai_responses: 'OpenAI Responses',
            ark_responses: 'Volcengine Ark Responses',
            anthropic: 'Anthropic'
        };
        const providerLabel = providerLabelMap[config.provider] || 'provider';

        if (!config.apiKey && !config.backupApiKey) {
            ui.addMessage('error', `Please set at least one ${providerLabel} API key in settings.`);
            settingsDiv.classList.remove('chat-settings-hidden');
            return;
        }

        if (!config.model) {
            ui.addMessage('error', `Please set a ${providerLabel} model name in settings.`);
            settingsDiv.classList.remove('chat-settings-hidden');
            return;
        }

        const activeSessionId = store.getActiveSessionId();
        if (typeof onUserMessageAccepted === 'function') {
            onUserMessageAccepted({
                sessionId: activeSessionId,
                text
            });
        }

        const userCreatedAt = Date.now();
        const turnId = createTurnId();

        const timestampPrefix = buildTimestampPrefix(config, userCreatedAt);
        const userNamePrefix = buildMessagePrefix(config);
        const userContextText = text
            ? applyMessagePrefix(text, userNamePrefix)
            : (userNamePrefix || '');
        const parts = [];
        if (text) {
            parts.push({
                type: 'text',
                text: userContextText || text
            });
        }
        if (!text && hasImages && userContextText) {
            parts.push({
                type: 'text',
                text: userContextText
            });
        }
        if (hasImages) {
            parts.push(...pendingImageParts);
        }
        const contentFallback = text || (hasImages ? '[Image]' : '');
        const displayContent = text
            ? userContextText
            : (
                userContextText
                    ? applyMessagePrefix(formatAttachmentNotice(pendingImageParts.length), userContextText)
                    : formatAttachmentNotice(pendingImageParts.length)
            );

        const messagesToAppend = [];

        if (timestampPrefix) {
            messagesToAppend.push(createChatMessage({
                role: 'user',
                content: timestampPrefix,
                turnId,
                metaOptions: {
                    displayContent: timestampPrefix,
                    contextContent: timestampPrefix,
                    createdAt: userCreatedAt,
                    displayRole: 'system',
                    isPrefixMessage: true,
                    prefixType: 'timestamp'
                }
            }));
        }

        messagesToAppend.push(createChatMessage({
            role: 'user',
            content: contentFallback,
            turnId,
            metaOptions: {
                displayContent,
                contextContent: userContextText || contentFallback,
                parts,
                createdAt: userCreatedAt
            }
        }));

        store.appendMessages(messagesToAppend);
        appendMessagesToUi(messagesToAppend);
        notifyConversationUpdated();

        chatInput.value = '';
        clearPendingImages();
        resizeInputToContent(chatInput);

        await generateAssistantResponse(config, turnId, text);
    }

    function stopGeneration() {
        store.requestAbort('user');
    }

    if (attachBtn && imageInput) {
        attachBtn.addEventListener('click', () => {
            imageInput.click();
        });

        imageInput.addEventListener('change', async () => {
            const files = Array.from(imageInput.files || []);
            try {
                await appendImageFiles(files);
            } catch (error) {
                ui.addSystemNotice(error?.message || 'Failed to attach image.', 3000);
            } finally {
                imageInput.value = '';
            }
        });
    }

    chatInput.addEventListener('paste', async (event) => {
        const items = Array.from(event.clipboardData?.items || []);
        const imageFiles = items
            .filter((item) => typeof item?.type === 'string' && item.type.startsWith('image/'))
            .map((item) => item.getAsFile())
            .filter(Boolean);

        if (imageFiles.length === 0) {
            return;
        }

        event.preventDefault();
        try {
            await appendImageFiles(imageFiles);
        } catch (error) {
            ui.addSystemNotice(error?.message || 'Failed to paste image.', 3000);
        }
    });

    renderAttachmentPreview();

    return {
        sendMessage,
        stopGeneration
    };
}




