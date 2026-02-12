import { SOURCES_MARKDOWN_MARKER } from './constants.js';

/**
 * Returns whether an HTTP status code should trigger retry logic.
 */
function shouldRetryStatus(statusCode) {
    return statusCode === 401 || statusCode === 403 || statusCode === 408 || statusCode === 429 || statusCode >= 500;
}

/**
 * Trims and normalizes API URL by removing trailing slashes.
 */
function normalizeApiUrl(apiUrl) {
    const trimmed = (apiUrl || '').trim().replace(/\/+$/, '');
    return trimmed || null;
}

/**
 * Estimates token usage for mixed CJK/Latin text.
 */
function estimateTokenCount(text) {
    const cjkChars = (text.match(/[\u4e00-\u9fff\u3000-\u303f]/g) || []).length;
    const otherChars = text.length - cjkChars;
    return Math.ceil(cjkChars / 1.5 + otherChars / 4);
}

/**
 * Creates a stable id for matching DOM actions back to conversation history.
 */
function createMessageId() {
    if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
        return globalThis.crypto.randomUUID();
    }

    return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Truncates text so estimated tokens stay inside a target budget.
 */
function truncateContentToTokenBudget(content, maxTokens) {
    if (!content || !Number.isFinite(maxTokens) || maxTokens <= 0) {
        return '';
    }

    let low = 0;
    let high = content.length;
    let best = '';

    while (low <= high) {
        const middle = Math.floor((low + high) / 2);
        const candidate = content.slice(0, middle);
        const tokenCount = estimateTokenCount(candidate) + 4;

        if (tokenCount <= maxTokens) {
            best = candidate;
            low = middle + 1;
        } else {
            high = middle - 1;
        }
    }

    return best.trim();
}

function formatPrefixTimestamp(timestamp) {
    const date = new Date(timestamp);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    return `[${year}-${month}-${day} ${hours}:${minutes}:${seconds}]`;
}

function formatNameTag(name) {
    const trimmed = (name || '').trim();
    if (!trimmed) return '';

    const hasAsciiBrackets = trimmed.startsWith('[') && trimmed.endsWith(']');
    const hasCjkBrackets = trimmed.startsWith('【') && trimmed.endsWith('】');
    const normalized = hasAsciiBrackets || hasCjkBrackets
        ? trimmed.slice(1, -1).trim()
        : trimmed;

    if (!normalized) return '';
    return `【${normalized}】`;
}

function buildNamePrefix(config) {
    if (!config.prefixWithName) {
        return '';
    }

    return formatNameTag(config.userName);
}

function buildTimestampPrefix(config, timestamp) {
    if (!config.prefixWithTime) {
        return '';
    }

    return formatPrefixTimestamp(timestamp);
}

function buildMessagePrefix(config) {
    const tags = [];

    const nameTag = buildNamePrefix(config);
    if (nameTag) {
        tags.push(nameTag);
    }

    return tags.join('\n');
}

function applyMessagePrefix(content, prefix) {
    const text = typeof content === 'string' ? content : '';
    if (!prefix) return text;
    return `${prefix}\n${text}`;
}

/**
 * Builds metadata for persisted chat messages.
 */
function buildMessageMeta(content, {
    displayContent = '',
    contextContent = '',
    createdAt = Date.now(),
    displayRole = '',
    isPrefixMessage = false,
    prefixType = ''
} = {}) {
    const contextForTokens = typeof contextContent === 'string' && contextContent
        ? contextContent
        : content;

    const meta = {
        messageId: createMessageId(),
        createdAt,
        tokenEstimate: estimateTokenCount(contextForTokens) + 4
    };

    if (typeof displayContent === 'string' && displayContent && displayContent !== content) {
        meta.displayContent = displayContent;
    }

    if (typeof contextContent === 'string' && contextContent && contextContent !== content) {
        meta.contextContent = contextContent;
    }

    if (displayRole === 'system' || displayRole === 'assistant' || displayRole === 'user') {
        meta.displayRole = displayRole;
    }

    if (isPrefixMessage) {
        meta.isPrefixMessage = true;
    }

    if (typeof prefixType === 'string' && prefixType) {
        meta.prefixType = prefixType;
    }

    return meta;
}

/**
 * Extracts plain text content from Gemini response parts.
 */
function parseGeminiText(responseData) {
    const parts = responseData?.candidates?.[0]?.content?.parts;
    if (!Array.isArray(parts)) return '';

    return parts
        .map((part) => (typeof part?.text === 'string' ? part.text : ''))
        .filter(Boolean)
        .join('');
}

/**
 * Removes display-only source markdown so it does not pollute future context.
 */
function stripGroundingMarkdown(text) {
    if (typeof text !== 'string') return '';

    const sourcesIndex = text.lastIndexOf(SOURCES_MARKDOWN_MARKER);
    if (sourcesIndex === -1) {
        return text;
    }

    return text.slice(0, sourcesIndex).trimEnd();
}

/**
 * Returns a context-safe raw message text from modern or legacy message shape.
 */
function getContextMessageContent(message) {
    if (typeof message?.meta?.contextContent === 'string' && message.meta.contextContent) {
        return message.meta.contextContent;
    }

    const rawContent = typeof message?.content === 'string' ? message.content : '';
    if (rawContent) {
        return rawContent;
    }

    if (typeof message?.meta?.displayContent === 'string') {
        return stripGroundingMarkdown(message.meta.displayContent);
    }

    return '';
}

/**
 * Normalizes raw history into context-safe user/model message pairs.
 */
function normalizeHistoryForContext(conversationHistory) {
    if (!Array.isArray(conversationHistory)) return [];

    return conversationHistory
        .filter((message) => message?.role === 'user' || message?.role === 'assistant')
        .map((message) => {
            const rawText = getContextMessageContent(message);
            const content = message.role === 'assistant'
                ? stripGroundingMarkdown(rawText).trim()
                : rawText.trim();

            return {
                role: message.role,
                content
            };
        })
        .filter((message) => message.content.length > 0);
}

function normalizeMaxContextMessages(value) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/**
 * Builds a token-limited context window from newest to oldest messages.
 */
function buildContextWindow(conversationHistory, maxContextTokens, maxContextMessages) {
    const normalizedHistory = normalizeHistoryForContext(conversationHistory);
    const safeMaxMessages = normalizeMaxContextMessages(maxContextMessages);

    let candidateHistory = normalizedHistory;
    let isTrimmed = false;

    if (safeMaxMessages && normalizedHistory.length > safeMaxMessages) {
        candidateHistory = normalizedHistory.slice(-safeMaxMessages);
        isTrimmed = true;
    }

    if (!candidateHistory.length) {
        return {
            messages: [],
            isTrimmed,
            tokenCount: 0,
            inputBudgetTokens: maxContextTokens,
            maxContextMessages: safeMaxMessages
        };
    }

    const safeMaxTokens = Number.isFinite(maxContextTokens) && maxContextTokens > 0
        ? maxContextTokens
        : 200000;

    const reserveOutputTokens = Math.max(1024, Math.floor(safeMaxTokens * 0.2));
    const inputBudgetTokens = Math.max(1024, safeMaxTokens - reserveOutputTokens);

    const selected = [];
    let usedTokens = 0;

    for (let index = candidateHistory.length - 1; index >= 0; index -= 1) {
        const message = candidateHistory[index];
        const messageTokens = estimateTokenCount(message.content) + 4;
        const exceedsBudget = usedTokens + messageTokens > inputBudgetTokens;

        if (exceedsBudget) {
            isTrimmed = true;

            // If the newest message alone is too large, keep a truncated slice
            // so requests still carry the latest user intent.
            if (selected.length === 0) {
                const truncatedContent = truncateContentToTokenBudget(message.content, inputBudgetTokens);
                if (truncatedContent) {
                    selected.push({
                        ...message,
                        content: truncatedContent
                    });
                    usedTokens = estimateTokenCount(truncatedContent) + 4;
                }
            }

            break;
        }

        selected.push(message);
        usedTokens += messageTokens;
    }

    return {
        messages: selected.reverse(),
        isTrimmed,
        tokenCount: usedTokens,
        inputBudgetTokens,
        maxContextMessages: safeMaxMessages
    };
}

/**
 * Builds Gemini request payload from context messages and runtime config.
 */
function buildGeminiRequestBody(contextMessages, config) {
    const body = {
        contents: contextMessages
            .map((message) => ({
                role: message.role === 'assistant' ? 'model' : 'user',
                parts: [{ text: message.content }]
            }))
    };

    if (config.systemPrompt) {
        body.systemInstruction = {
            parts: [{ text: config.systemPrompt }]
        };
    }

    if (config.searchMode === 'gemini_google_search') {
        body.tools = [{ google_search: {} }];
    }

    if (Number.isFinite(config.thinkingBudget) && config.thinkingBudget > 0) {
        body.generationConfig = {
            thinkingConfig: {
                thinkingBudget: config.thinkingBudget
            }
        };
    }

    return body;
}

/**
 * Reads error details from Gemini response, preferring structured JSON message.
 */
async function readErrorDetails(response) {
    try {
        const errorPayload = await response.json();
        if (errorPayload?.error?.message) {
            return errorPayload.error.message;
        }

        return JSON.stringify(errorPayload);
    } catch {
        try {
            return await response.text();
        } catch {
            return 'Unknown Gemini API error';
        }
    }
}

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

function buildContextPreview(messages) {
    return messages.map((message, index) => {
        const singleLine = message.content.replace(/\s+/g, ' ').trim();
        const text = singleLine.length > CONTEXT_DEBUG_PREVIEW_CHARS
            ? `${singleLine.slice(0, CONTEXT_DEBUG_PREVIEW_CHARS)}...`
            : singleLine;

        return {
            index,
            role: message.role,
            preview: text
        };
    });
}

function logContextWindowDebug(contextWindow, config) {
    if (!isContextDebugEnabled()) {
        return;
    }

    const userMessageCount = contextWindow.messages.filter((message) => message.role === 'user').length;
    const assistantMessageCount = contextWindow.messages.length - userMessageCount;

    console.info('[ChatContext]', {
        model: config.model,
        totalMessages: contextWindow.messages.length,
        userMessages: userMessageCount,
        assistantMessages: assistantMessageCount,
        tokenCount: contextWindow.tokenCount,
        inputBudgetTokens: contextWindow.inputBudgetTokens,
        maxContextMessages: contextWindow.maxContextMessages,
        trimmed: contextWindow.isTrimmed,
        preview: buildContextPreview(contextWindow.messages)
    });
}

export function createApiManager({
    state,
    elements,
    ui,
    configManager,
    historyManager,
    constants,
    renderMarkdown,
    escapeHtml
}) {
    const { chatInput, settingsDiv } = elements;
    const {
        connectTimeoutMs,
        maxRetries,
        maxContextTokens = 200000,
        maxContextMessages = 120
    } = constants;

    let contextTrimNoticeShown = false;

    function notifyContextTrim(isTrimmed) {
        if (!isTrimmed) {
            contextTrimNoticeShown = false;
            return;
        }

        if (contextTrimNoticeShown) return;

        ui.addSystemNotice('Older messages were excluded from model context due to token limits.', 3500);
        contextTrimNoticeShown = true;
    }

    /**
     * Executes fetch with exponential backoff retry for retryable failures.
     */
    async function fetchWithRetry(url, options) {
        let lastError = null;

        for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
            try {
                const response = await fetch(url, options);
                if (shouldRetryStatus(response.status) && attempt < maxRetries) {
                    const delayMs = Math.min(1000 * (2 ** attempt), 8000);
                    ui.showRetryNotice(attempt + 1, maxRetries, delayMs);
                    await new Promise((resolve) => setTimeout(resolve, delayMs));
                    continue;
                }

                return response;
            } catch (error) {
                lastError = error;

                if (error.name === 'AbortError') {
                    throw error;
                }

                if (attempt >= maxRetries) {
                    throw error;
                }

                const delayMs = Math.min(1000 * (2 ** attempt), 8000);
                ui.showRetryNotice(attempt + 1, maxRetries, delayMs);
                await new Promise((resolve) => setTimeout(resolve, delayMs));
            }
        }

        throw lastError || new Error('Request failed after retries');
    }

    /**
     * Sends request to Gemini with primary key, then automatically falls back
     * to backup key when available.
     */
    async function requestGeminiWithFallbackKeys(config, requestBody) {
        const baseUrl = normalizeApiUrl(config.apiUrl);
        if (!baseUrl) {
            throw new Error('Gemini API URL is required.');
        }

        if (!config.model) {
            throw new Error('Gemini model is required.');
        }

        const endpoint = `${baseUrl}/models/${encodeURIComponent(config.model)}:generateContent`;
        const apiKeys = [config.apiKey, config.backupApiKey]
            .map((key) => key.trim())
            .filter(Boolean);

        if (!apiKeys.length) {
            throw new Error('At least one API key is required.');
        }

        const hasBackupKey = apiKeys.length > 1;
        let lastError = null;

        for (let keyIndex = 0; keyIndex < apiKeys.length; keyIndex += 1) {
            const apiKey = apiKeys[keyIndex];

            try {
                const response = await fetchWithRetry(endpoint, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'x-goog-api-key': apiKey
                    },
                    body: JSON.stringify(requestBody),
                    signal: state.abortController.signal
                });

                if (response.ok) {
                    return response.json();
                }

                const details = await readErrorDetails(response);
                lastError = new Error(`HTTP ${response.status}: ${details}`);

                if (keyIndex === 0 && hasBackupKey) {
                    ui.showBackupKeyNotice();
                    continue;
                }

                throw lastError;
            } catch (error) {
                if (error.name === 'AbortError') {
                    throw error;
                }

                lastError = error;
                if (keyIndex === 0 && hasBackupKey) {
                    ui.showBackupKeyNotice();
                    continue;
                }

                throw error;
            }
        }

        throw lastError || new Error('Gemini request failed');
    }

    /**
     * Handles a full assistant generation cycle:
     * 1) build a token-managed context window
     * 2) request Gemini response
     * 3) persist raw assistant text for future context
     * 4) render display text with optional Sources section
     */
    async function generateAssistantResponse(config) {
        const effectiveMaxContextMessages = resolveContextMaxMessages(maxContextMessages);
        const contextWindow = buildContextWindow(
            state.conversationHistory,
            maxContextTokens,
            effectiveMaxContextMessages
        );
        notifyContextTrim(contextWindow.isTrimmed);
        logContextWindowDebug(contextWindow, config);

        const assistantMessage = ui.addMessage('assistant', '');
        assistantMessage.innerHTML = '<span class="chat-loading"><span></span><span></span><span></span></span>';
        assistantMessage.classList.add('typing');

        state.isStreaming = true;
        state.abortReason = '';
        state.abortController = new AbortController();
        ui.setStreamingUI(true);

        const timeoutId = setTimeout(() => {
            if (!state.isStreaming) return;
            state.abortReason = 'connect_timeout';
            state.abortController.abort();
        }, connectTimeoutMs);

        try {
            const requestBody = buildGeminiRequestBody(contextWindow.messages, config);
            const responseData = await requestGeminiWithFallbackKeys(config, requestBody);

            const assistantRawText = parseGeminiText(responseData).trim() || '(No response text)';
            const assistantCreatedAt = Date.now();
            const assistantContextText = assistantRawText;
            const assistantDisplayText = assistantContextText;

            assistantMessage.classList.remove('typing');
            assistantMessage.innerHTML = renderMarkdown(assistantDisplayText);
            ui.addCopyButtons(assistantMessage);
            ui.scrollToBottom();

            state.conversationHistory.push({
                role: 'assistant',
                content: assistantRawText,
                meta: buildMessageMeta(assistantRawText, {
                    displayContent: assistantDisplayText,
                    contextContent: assistantContextText,
                    createdAt: assistantCreatedAt
                })
            });
            historyManager.saveCurrentSession();
        } catch (error) {
            if (error.name === 'AbortError') {
                if (state.abortReason === 'connect_timeout') {
                    assistantMessage.className = 'chat-msg error';
                    assistantMessage.innerHTML = 'Connection timeout<br><small>Check network status and Gemini API URL.</small>';
                } else if (state.abortReason === 'user') {
                    assistantMessage.remove();
                    ui.addSystemNotice('Generation stopped by user.');
                }
            } else {
                assistantMessage.className = 'chat-msg error';
                const message = error?.message || 'Unknown error';
                assistantMessage.innerHTML = `Request failed<br><small>${escapeHtml(message)}</small>`;
            }
        } finally {
            clearTimeout(timeoutId);
            assistantMessage.classList.remove('typing');
            state.isStreaming = false;
            state.abortController = null;
            state.abortReason = '';
            ui.setStreamingUI(false);
            chatInput.focus();
        }
    }

    /**
     * Validates user input + config, saves user message, and triggers generation.
     */
    async function sendMessage() {
        const text = chatInput.value.trim();
        if (!text || state.isStreaming) return;

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

        const userCreatedAt = Date.now();
        const timestampPrefix = buildTimestampPrefix(config, userCreatedAt);
        const userNamePrefix = buildMessagePrefix(config);
        const userContextText = applyMessagePrefix(text, userNamePrefix);

        if (timestampPrefix) {
            const timestampMessage = {
                role: 'user',
                content: timestampPrefix,
                meta: buildMessageMeta(timestampPrefix, {
                    displayContent: timestampPrefix,
                    contextContent: timestampPrefix,
                    createdAt: userCreatedAt,
                    displayRole: 'system',
                    isPrefixMessage: true,
                    prefixType: 'timestamp'
                })
            };

            state.conversationHistory.push(timestampMessage);
            ui.addMessage('user', timestampPrefix, timestampMessage.meta);
        }

        const userMessage = {
            role: 'user',
            content: text,
            meta: buildMessageMeta(text, {
                displayContent: userContextText,
                contextContent: userContextText,
                createdAt: userCreatedAt
            })
        };

        state.conversationHistory.push(userMessage);
        ui.addMessage('user', userContextText, userMessage.meta);
        historyManager.saveCurrentSession();

        chatInput.value = '';
        chatInput.style.height = 'auto';

        await generateAssistantResponse(config);
    }

    return {
        sendMessage
    };
}
