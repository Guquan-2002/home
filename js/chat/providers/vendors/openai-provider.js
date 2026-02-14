/**
 * OpenAI Provider 客户端
 *
 * 职责：
 * - 实现 OpenAI Chat Completions 和 Responses API 的完整调用逻辑
 * - 支持两种 API 模式的统一封装
 * - 处理请求重试（指数退避算法）
 * - 支持备用 API 密钥的自动切换
 * - 解析 SSE 流式响应和非流式响应
 * - 支持请求取消（AbortSignal）
 *
 * 依赖：
 * - local-message.js（消息封装构建）
 * - message-model.js（消息分割）
 * - constants.js（Provider ID）
 * - format-router.js（请求构建）
 * - system-instruction.js（系统指令构建）
 *
 * 被依赖：chat.js（通过 provider-router）
 */
import { buildLocalMessageEnvelope } from '../../core/local-message.js';
import { splitAssistantMessageByMarker } from '../../core/message-model.js';
import { CHAT_PROVIDER_IDS } from '../../constants.js';
import { buildProviderRequest } from '../format-router.js';
import { buildSystemInstruction } from '../system-instruction.js';

/** OpenAI API 模式枚举 */
const OPENAI_API_MODES = Object.freeze({
    chatCompletions: 'chat-completions',
    responses: 'responses'
});

/** 判断 HTTP 状态码是否应该重试 */
function shouldRetryStatus(statusCode) {
    return statusCode === 408 || statusCode === 429 || statusCode >= 500;
}

/**
 * 从内容对象中提取文本
 *
 * 支持多种格式：
 * - 字符串：直接返回
 * - 数组：提取所有 text/content 字段并合并
 *
 * @param {string|Array} content - 内容对象
 * @returns {string} 提取的文本
 */
function extractTextFromContent(content) {
    if (typeof content === 'string') {
        return content;
    }

    if (Array.isArray(content)) {
        return content
            .map((item) => {
                if (typeof item === 'string') {
                    return item;
                }

                if (typeof item?.text === 'string') {
                    return item.text;
                }

                if (typeof item?.content === 'string') {
                    return item.content;
                }

                return '';
            })
            .filter(Boolean)
            .join('');
    }

    return '';
}

/**
 * 解析 Chat Completions API 响应中的文本
 * @param {Object} responseData - API 响应数据
 * @returns {string} 提取的文本内容
 */
function parseOpenAiText(responseData) {
    const choices = Array.isArray(responseData?.choices) ? responseData.choices : [];
    return choices
        .map((choice) => extractTextFromContent(choice?.message?.content))
        .filter(Boolean)
        .join('');
}

/**
 * 解析 Chat Completions API 流式响应中的文本增量
 * @param {Object} responseData - SSE 事件数据
 * @returns {string} 文本增量
 */
function parseOpenAiStreamDelta(responseData) {
    const choices = Array.isArray(responseData?.choices) ? responseData.choices : [];
    return choices
        .map((choice) => extractTextFromContent(choice?.delta?.content))
        .filter(Boolean)
        .join('');
}

/**
 * 解析 Responses API 响应中的文本
 *
 * 支持两种格式：
 * - output_text 字段（简化格式）
 * - output 数组（完整格式）
 *
 * @param {Object} responseData - API 响应数据
 * @returns {string} 提取的文本内容
 */
function parseOpenAiResponseText(responseData) {
    if (typeof responseData?.output_text === 'string' && responseData.output_text) {
        return responseData.output_text;
    }

    const outputItems = Array.isArray(responseData?.output) ? responseData.output : [];
    return outputItems
        .map((item) => {
            if (typeof item?.text === 'string') {
                return item.text;
            }

            const contentItems = Array.isArray(item?.content) ? item.content : [];
            return contentItems
                .map((contentItem) => {
                    if (typeof contentItem?.text === 'string') {
                        return contentItem.text;
                    }

                    if (typeof contentItem?.content === 'string') {
                        return contentItem.content;
                    }

                    return '';
                })
                .filter(Boolean)
                .join('');
        })
        .filter(Boolean)
        .join('');
}

/**
 * 解析 Responses API 流式响应中的文本增量
 * @param {Object} responseData - SSE 事件数据
 * @returns {string} 文本增量
 */
function parseOpenAiResponseStreamDelta(responseData) {
    // 仅消费输出文本增量，避免将工具参数等非文本 delta 串到聊天内容中。
    if (
        responseData?.type === 'response.output_text.delta'
        && typeof responseData?.delta === 'string'
        && responseData.delta
    ) {
        return responseData.delta;
    }

    return '';
}

/** 判断是否为 Responses API 模式 */
function isResponsesMode(apiMode) {
    return apiMode === OPENAI_API_MODES.responses;
}

/** 解析请求封装对象（同 Anthropic） */
function resolveRequestEnvelope(config, contextMessages, localMessageEnvelope, enableMarkerSplit) {
    const normalizedEnvelope = buildLocalMessageEnvelope(
        localMessageEnvelope || { messages: contextMessages },
        {
            fallbackSystemInstruction: typeof config?.systemPrompt === 'string' ? config.systemPrompt : ''
        }
    );

    return {
        ...normalizedEnvelope,
        systemInstruction: buildSystemInstruction(config, enableMarkerSplit)
    };
}

/** 读取错误响应的详细信息（同 Anthropic） */
async function readErrorDetails(response) {
    try {
        const errorPayload = await response.json();
        if (typeof errorPayload?.error?.message === 'string' && errorPayload.error.message) {
            return errorPayload.error.message;
        }

        return JSON.stringify(errorPayload);
    } catch {
        try {
            return await response.text();
        } catch {
            return 'Unknown OpenAI API error';
        }
    }
}

/** 创建 AbortError 错误对象（同 Anthropic） */
function createAbortError() {
    if (typeof DOMException === 'function') {
        return new DOMException('The operation was aborted.', 'AbortError');
    }

    const error = new Error('The operation was aborted.');
    error.name = 'AbortError';
    return error;
}

/** 等待重试延迟（同 Anthropic） */
function waitForRetryDelay(delayMs, signal) {
    if (!Number.isFinite(delayMs) || delayMs <= 0) {
        return Promise.resolve();
    }

    if (signal?.aborted) {
        return Promise.reject(createAbortError());
    }

    return new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
            if (signal) {
                signal.removeEventListener('abort', onAbort);
            }
            resolve();
        }, delayMs);

        const onAbort = () => {
            clearTimeout(timeoutId);
            if (signal) {
                signal.removeEventListener('abort', onAbort);
            }
            reject(createAbortError());
        };

        if (signal) {
            signal.addEventListener('abort', onAbort, { once: true });
        }
    });
}

/** 带重试的 Fetch 请求（同 Anthropic） */
async function fetchWithRetry(fetchImpl, url, options, {
    maxRetries,
    maxRetryDelayMs,
    onRetryNotice
}) {
    let lastError = null;

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
        try {
            const response = await fetchImpl(url, options);
            if (shouldRetryStatus(response.status) && attempt < maxRetries) {
                const delayMs = Math.min(1000 * (2 ** attempt), maxRetryDelayMs);
                onRetryNotice?.(attempt + 1, maxRetries, delayMs);
                await waitForRetryDelay(delayMs, options?.signal);
                continue;
            }

            return response;
        } catch (error) {
            lastError = error;

            if (error?.name === 'AbortError') {
                throw error;
            }

            if (attempt >= maxRetries) {
                throw error;
            }

            const delayMs = Math.min(1000 * (2 ** attempt), maxRetryDelayMs);
            onRetryNotice?.(attempt + 1, maxRetries, delayMs);
            await waitForRetryDelay(delayMs, options?.signal);
        }
    }

    throw lastError || new Error('Request failed after retries');
}

/** 提取 SSE 事件中的 data 字段内容（同 Anthropic） */
function extractSseDataPayload(rawEvent) {
    const lines = rawEvent.split(/\r?\n/);
    const dataLines = [];

    for (const line of lines) {
        if (line.startsWith('data:')) {
            dataLines.push(line.slice(5).trimStart());
        }
    }

    if (dataLines.length === 0) {
        return '';
    }

    return dataLines.join('\n');
}

/**
 * 读取 SSE 流并解析为 JSON 事件
 *
 * 与 Anthropic 的区别：
 * - 支持 [DONE] 标记（遇到时立即结束）
 *
 * @param {Response} response - Fetch API 响应对象
 * @param {AbortSignal} signal - 取消信号
 * @yields {Object} 解析后的 JSON 事件对象
 */
async function* readSseJsonEvents(response, signal) {
    const stream = response?.body;
    if (!stream || typeof stream.getReader !== 'function') {
        throw new Error('OpenAI stream response body is empty.');
    }

    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
        while (true) {
            if (signal?.aborted) {
                throw createAbortError();
            }

            const { value, done } = await reader.read();
            if (done) {
                break;
            }

            buffer += decoder.decode(value, { stream: true });

            while (true) {
                const delimiterMatch = /\r?\n\r?\n/.exec(buffer);
                if (!delimiterMatch) {
                    break;
                }

                const rawEvent = buffer.slice(0, delimiterMatch.index);
                buffer = buffer.slice(delimiterMatch.index + delimiterMatch[0].length);
                const rawData = extractSseDataPayload(rawEvent);
                if (!rawData) {
                    continue;
                }

                if (rawData === '[DONE]') {
                    return;
                }

                try {
                    yield JSON.parse(rawData);
                } catch {
                    // Ignore malformed payload.
                }
            }
        }
    } finally {
        reader.releaseLock?.();
    }
}

/** 构建 API 密钥数组（同 Anthropic） */
function buildApiKeys(config) {
    return [config.apiKey, config.backupApiKey]
        .map((key) => (typeof key === 'string' ? key.trim() : ''))
        .filter(Boolean);
}

/**
 * 根据 API 模式创建 OpenAI Provider 实例
 *
 * 支持两种模式：
 * - chat-completions: Chat Completions API
 * - responses: Responses API
 *
 * @param {Object} options - 创建选项
 * @param {string} options.providerId - Provider ID
 * @param {string} options.apiMode - API 模式
 * @param {Function} [options.fetchImpl] - Fetch 实现函数
 * @param {number} [options.maxRetries=3] - 最大重试次数
 * @param {number} [options.maxRetryDelayMs=8000] - 最大重试延迟（毫秒）
 * @returns {ChatProvider} Provider 实例
 */
function createOpenAiProviderByMode({
    providerId,
    apiMode,
    fetchImpl = globalThis.fetch?.bind(globalThis),
    maxRetries = 3,
    maxRetryDelayMs = 8000
} = {}) {
    if (typeof fetchImpl !== 'function') {
        throw new Error('fetch implementation is required for OpenAI provider.');
    }

    if (!providerId || typeof providerId !== 'string') {
        throw new Error('OpenAI provider id is required.');
    }

    if (apiMode !== OPENAI_API_MODES.chatCompletions && apiMode !== OPENAI_API_MODES.responses) {
        throw new Error('Unsupported OpenAI API mode.');
    }

    return {
        id: providerId,
        /**
         * 非流式生成方法
         *
         * 根据 apiMode 选择对应的响应解析器
         */
        async generate({
            config,
            contextMessages,
            localMessageEnvelope,
            signal,
            onRetryNotice,
            onFallbackKey
        }) {
            if (!config?.model) {
                throw new Error('OpenAI model is required.');
            }

            const apiKeys = buildApiKeys(config);
            if (apiKeys.length === 0) {
                throw new Error('At least one API key is required.');
            }

            const enableMarkerSplit = config?.enablePseudoStream === true;
            const requestEnvelope = resolveRequestEnvelope(
                config,
                contextMessages,
                localMessageEnvelope,
                enableMarkerSplit
            );
            const hasBackupKey = apiKeys.length > 1;
            let lastError = null;
            let fallbackNoticeShown = false;

            for (let keyIndex = 0; keyIndex < apiKeys.length; keyIndex += 1) {
                try {
                    const request = buildProviderRequest({
                        providerId,
                        config,
                        envelope: requestEnvelope,
                        stream: false,
                        apiKey: apiKeys[keyIndex]
                    });
                    const response = await fetchWithRetry(fetchImpl, request.endpoint, {
                        method: 'POST',
                        headers: request.headers,
                        body: JSON.stringify(request.body),
                        signal
                    }, {
                        maxRetries,
                        maxRetryDelayMs,
                        onRetryNotice
                    });

                    if (!response.ok) {
                        const details = await readErrorDetails(response);
                        throw new Error(`HTTP ${response.status}: ${details}`);
                    }

                    const responseData = await response.json();
                    const assistantRawText = isResponsesMode(apiMode)
                        ? parseOpenAiResponseText(responseData)
                        : parseOpenAiText(responseData);

                    return {
                        segments: splitAssistantMessageByMarker(assistantRawText, {
                            enableMarkerSplit
                        })
                    };
                } catch (error) {
                    if (error?.name === 'AbortError') {
                        throw error;
                    }

                    lastError = error;
                    if (keyIndex === 0 && hasBackupKey) {
                        if (!fallbackNoticeShown) {
                            onFallbackKey?.();
                            fallbackNoticeShown = true;
                        }
                        continue;
                    }

                    throw error;
                }
            }

            throw lastError || new Error('OpenAI request failed.');
        },

        /**
         * 流式生成方法
         *
         * 根据 apiMode 选择对应的流式响应解析器
         */
        async *generateStream({
            config,
            contextMessages,
            localMessageEnvelope,
            signal,
            onRetryNotice,
            onFallbackKey
        }) {
            if (!config?.model) {
                throw new Error('OpenAI model is required.');
            }

            const apiKeys = buildApiKeys(config);
            if (apiKeys.length === 0) {
                throw new Error('At least one API key is required.');
            }

            const enableMarkerSplit = config?.enablePseudoStream === true;
            const requestEnvelope = resolveRequestEnvelope(
                config,
                contextMessages,
                localMessageEnvelope,
                enableMarkerSplit
            );
            const hasBackupKey = apiKeys.length > 1;
            let fallbackNoticeShown = false;
            let emittedAnyDelta = false;
            let lastError = null;

            for (let keyIndex = 0; keyIndex < apiKeys.length; keyIndex += 1) {
                try {
                    const request = buildProviderRequest({
                        providerId,
                        config,
                        envelope: requestEnvelope,
                        stream: true,
                        apiKey: apiKeys[keyIndex]
                    });
                    const response = await fetchWithRetry(fetchImpl, request.endpoint, {
                        method: 'POST',
                        headers: request.headers,
                        body: JSON.stringify(request.body),
                        signal
                    }, {
                        maxRetries,
                        maxRetryDelayMs,
                        onRetryNotice
                    });

                    if (!response.ok) {
                        const details = await readErrorDetails(response);
                        throw new Error(`HTTP ${response.status}: ${details}`);
                    }

                    // HTTP 200 已返回，连接已建立。立即通知上层清除连接超时，
                    // 避免模型长时间思考（如 high reasoning）期间被误判为超时。
                    yield { type: 'ping' };

                    for await (const payload of readSseJsonEvents(response, signal)) {
                        const deltaText = isResponsesMode(apiMode)
                            ? parseOpenAiResponseStreamDelta(payload)
                            : parseOpenAiStreamDelta(payload);
                        if (!deltaText) {
                            yield { type: 'ping' };
                            continue;
                        }

                        emittedAnyDelta = true;
                        yield {
                            type: 'text-delta',
                            text: deltaText
                        };
                    }

                    yield { type: 'done' };
                    return;
                } catch (error) {
                    if (error?.name === 'AbortError') {
                        throw error;
                    }

                    lastError = error;
                    const canTryBackup = keyIndex === 0 && hasBackupKey && !emittedAnyDelta;
                    if (canTryBackup) {
                        if (!fallbackNoticeShown) {
                            onFallbackKey?.();
                            fallbackNoticeShown = true;
                            yield { type: 'fallback-key' };
                        }
                        continue;
                    }

                    throw error;
                }
            }

            throw lastError || new Error('OpenAI stream request failed.');
        }
    };
}

/**
 * 创建 OpenAI Chat Completions Provider 实例
 * @param {Object} options - 创建选项
 * @returns {ChatProvider} Provider 实例
 */
export function createOpenAiProvider(options = {}) {
    return createOpenAiProviderByMode({
        ...options,
        providerId: CHAT_PROVIDER_IDS.openai,
        apiMode: OPENAI_API_MODES.chatCompletions
    });
}

/**
 * 创建 OpenAI Responses Provider 实例
 * @param {Object} options - 创建选项
 * @returns {ChatProvider} Provider 实例
 */
export function createOpenAiResponsesProvider(options = {}) {
    return createOpenAiProviderByMode({
        ...options,
        providerId: CHAT_PROVIDER_IDS.openaiResponses,
        apiMode: OPENAI_API_MODES.responses
    });
}


