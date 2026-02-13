import { buildContextPreview, buildContextWindow, normalizeMaxContextMessages } from './core/context-window.js';
import { createChatMessage, createTurnId, getMessageDisplayContent } from './core/message-model.js';
import { applyMessagePrefix, buildMessagePrefix, buildTimestampPrefix } from './core/prefix.js';
import { assertProvider } from './providers/provider-interface.js';

const CONTEXT_DEBUG_STORAGE_KEY = 'llm_chat_context_debug';
const CONTEXT_MAX_MESSAGES_STORAGE_KEY = 'llm_chat_context_max_messages';
const CONTEXT_DEBUG_PREVIEW_CHARS = 80;

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

export function createApiManager({
    store,
    elements,
    ui,
    configManager,
    provider,
    constants,
    escapeHtml,
    onConversationUpdated = null
}) {
    const providerClient = assertProvider(provider);

    const { chatInput, settingsDiv } = elements;
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

    async function generateAssistantResponse(config, turnId) {
        const requestSessionId = store.getActiveSessionId();
        const effectiveMaxContextMessages = resolveContextMaxMessages(maxContextMessages);
        const contextWindow = buildContextWindow(
            store.getActiveMessages(),
            maxContextTokens,
            effectiveMaxContextMessages
        );

        notifyContextTrim(contextWindow.isTrimmed);
        logContextWindowDebug(contextWindow, config);

        const loadingMessage = ui.addLoadingMessage();

        const abortController = new AbortController();
        store.startStreaming(abortController);
        ui.setStreamingUI(true);

        const timeoutId = setTimeout(() => {
            if (!store.isStreaming()) {
                return;
            }

            store.setAbortReason('connect_timeout');
            abortController.abort();
        }, connectTimeoutMs);

        try {
            const response = await providerClient.generate({
                config,
                contextMessages: contextWindow.messages,
                signal: abortController.signal,
                onRetryNotice: (attempt, maxRetries, delayMs) => {
                    ui.showRetryNotice(attempt, maxRetries, delayMs);
                },
                onFallbackKey: () => {
                    ui.showBackupKeyNotice();
                }
            });

            if (store.getActiveSessionId() !== requestSessionId) {
                loadingMessage.remove();
                return;
            }

            loadingMessage.remove();

            const createdAt = Date.now();
            const assistantMessages = response.segments.map((segment, index) => createChatMessage({
                role: 'assistant',
                content: segment,
                turnId,
                metaOptions: {
                    createdAt: createdAt + index
                }
            }));

            store.appendMessages(assistantMessages);
            appendMessagesToUi(assistantMessages);
            notifyConversationUpdated();
        } catch (error) {
            if (store.getActiveSessionId() !== requestSessionId) {
                loadingMessage.remove();
                return;
            }

            if (error?.name === 'AbortError') {
                const abortReason = store.getAbortReason();
                if (abortReason === 'connect_timeout') {
                    loadingMessage.className = 'chat-msg error';
                    loadingMessage.innerHTML = 'Connection timeout<br><small>Check network status and Gemini API URL.</small>';
                } else if (abortReason === 'user') {
                    loadingMessage.remove();
                    ui.addSystemNotice('Generation stopped by user.');
                }
            } else {
                loadingMessage.className = 'chat-msg error';
                const message = error?.message || 'Unknown error';
                loadingMessage.innerHTML = `Request failed<br><small>${escapeHtml(message)}</small>`;
            }
        } finally {
            clearTimeout(timeoutId);
            loadingMessage.classList.remove('typing');
            store.finishStreaming();
            ui.setStreamingUI(false);
            chatInput.focus();
        }
    }

    async function sendMessage() {
        const text = chatInput.value.trim();
        if (!text || store.isStreaming()) {
            return;
        }

        const config = configManager.getConfig();

        if (!config.apiKey && !config.backupApiKey) {
            ui.addMessage('error', 'Please set at least one Gemini API key in settings.');
            settingsDiv.classList.remove('chat-settings-hidden');
            return;
        }

        if (!config.model) {
            ui.addMessage('error', 'Please set a Gemini model name in settings.');
            settingsDiv.classList.remove('chat-settings-hidden');
            return;
        }

        if (config.provider !== 'gemini') {
            ui.addMessage('error', 'Only Gemini provider is currently supported.');
            settingsDiv.classList.remove('chat-settings-hidden');
            return;
        }

        const userCreatedAt = Date.now();
        const turnId = createTurnId();

        const timestampPrefix = buildTimestampPrefix(config, userCreatedAt);
        const userNamePrefix = buildMessagePrefix(config);
        const userContextText = applyMessagePrefix(text, userNamePrefix);

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
            content: text,
            turnId,
            metaOptions: {
                displayContent: userContextText,
                contextContent: userContextText,
                createdAt: userCreatedAt
            }
        }));

        store.appendMessages(messagesToAppend);
        appendMessagesToUi(messagesToAppend);
        notifyConversationUpdated();

        chatInput.value = '';
        chatInput.style.height = 'auto';

        await generateAssistantResponse(config, turnId);
    }

    function stopGeneration() {
        store.requestAbort('user');
    }

    return {
        sendMessage,
        stopGeneration
    };
}
