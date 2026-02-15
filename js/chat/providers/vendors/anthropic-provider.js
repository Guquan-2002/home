/**
 * Anthropic Provider 客户端
 *
 * 职责：
 * - 实现 Anthropic Messages API 的完整调用逻辑
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

const ANTHROPIC_NON_STREAM_THINKING_MAX_TOKENS = 21333;

/**
 * 判断 HTTP 状态码是否应该重试
 * @param {number} statusCode - HTTP 状态码
 * @returns {boolean} 是否应该重试
 */
function shouldRetryStatus(statusCode) {
    return statusCode === 408 || statusCode === 429 || statusCode >= 500;
}

/**
 * 解析 Anthropic 响应中的文本内容
 *
 * 从 content 数组中提取所有 text 类型的 block
 *
 * @param {Object} responseData - Anthropic API 响应数据
 * @returns {string} 提取的文本内容
 */
function parseAnthropicText(responseData) {
    const blocks = Array.isArray(responseData?.content) ? responseData.content : [];
    return blocks
        .map((block) => (
            block?.type === 'text' && typeof block?.text === 'string'
                ? block.text
                : ''
        ))
        .filter(Boolean)
        .join('');
}

/**
 * 解析 Anthropic 流式响应中的文本增量
 *
 * 只处理 content_block_delta 类型且 delta.type 为 text_delta 的事件
 *
 * @param {Object} responseData - SSE 事件数据
 * @returns {string} 文本增量（如果不是文本增量事件则返回空字符串）
 */
function parseAnthropicStreamDelta(responseData) {
    if (responseData?.type !== 'content_block_delta') {
        return '';
    }

    if (responseData?.delta?.type !== 'text_delta') {
        return '';
    }

    return typeof responseData?.delta?.text === 'string'
        ? responseData.delta.text
        : '';
}

function parseAnthropicReasoningSignal(responseData) {
    if (responseData?.type === 'content_block_start') {
        return responseData?.content_block?.type === 'thinking';
    }

    if (responseData?.type !== 'content_block_delta') {
        return false;
    }

    const deltaType = typeof responseData?.delta?.type === 'string'
        ? responseData.delta.type
        : '';
    if (deltaType === 'thinking_delta' || deltaType === 'signature_delta') {
        return true;
    }

    return typeof responseData?.delta?.thinking === 'string'
        && responseData.delta.thinking.trim().length > 0;
}

/**
 * 解析 Anthropic 流式响应中的错误事件
 *
 * @param {Object} responseData - SSE 事件数据
 * @returns {string} 错误消息（如果不是错误事件则返回空字符串）
 */
function parseAnthropicStreamError(responseData) {
    if (responseData?.type !== 'error') {
        return '';
    }

    const providerMessage = typeof responseData?.error?.message === 'string'
        ? responseData.error.message.trim()
        : '';
    if (providerMessage) {
        return providerMessage;
    }

    try {
        return `Anthropic stream error: ${JSON.stringify(responseData)}`;
    } catch {
        return 'Anthropic stream error.';
    }
}

/**
 * 解析请求封装对象
 *
 * 算法：
 * 1. 规范化消息封装（处理系统指令回退）
 * 2. 构建完整的系统指令（包含标记分割规则）
 *
 * @param {Object} config - Provider 配置
 * @param {Array} contextMessages - 上下文消息数组
 * @param {Object} localMessageEnvelope - 本地消息封装
 * @param {boolean} enableMarkerSplit - 是否启用标记分割
 * @returns {Object} 请求封装对象
 */
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

/**
 * 读取错误响应的详细信息
 *
 * 尝试按以下顺序解析错误：
 * 1. JSON 格式的 error.message
 * 2. 完整的 JSON 字符串
 * 3. 纯文本响应
 * 4. 默认错误消息
 *
 * @param {Response} response - Fetch API 响应对象
 * @returns {Promise<string>} 错误详情
 */
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
            return 'Unknown Anthropic API error';
        }
    }
}

/**
 * 创建 AbortError 错误对象
 *
 * 优先使用 DOMException，否则创建普通 Error 并设置 name 属性
 *
 * @returns {Error} AbortError 错误对象
 */
function createAbortError() {
    if (typeof DOMException === 'function') {
        return new DOMException('The operation was aborted.', 'AbortError');
    }

    const error = new Error('The operation was aborted.');
    error.name = 'AbortError';
    return error;
}

/**
 * 等待重试延迟
 *
 * 支持 AbortSignal 取消等待
 *
 * @param {number} delayMs - 延迟毫秒数
 * @param {AbortSignal} signal - 取消信号
 * @returns {Promise<void>} 延迟 Promise
 */
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

/**
 * 带重试的 Fetch 请求
 *
 * 算法：
 * 1. 使用指数退避算法计算重试延迟：min(1000 * 2^attempt, maxRetryDelayMs)
 * 2. 对于可重试的状态码（408, 429, 5xx）或网络错误，自动重试
 * 3. 对于 AbortError，立即抛出不重试
 * 4. 达到最大重试次数后抛出最后的错误
 *
 * @param {Function} fetchImpl - Fetch 实现函数
 * @param {string} url - 请求 URL
 * @param {Object} options - Fetch 选项
 * @param {Object} retryOptions - 重试配置
 * @param {number} retryOptions.maxRetries - 最大重试次数
 * @param {number} retryOptions.maxRetryDelayMs - 最大重试延迟（毫秒）
 * @param {Function} retryOptions.onRetryNotice - 重试通知回调
 * @returns {Promise<Response>} Fetch 响应
 */
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

/**
 * 发送 Anthropic 请求并返回原始 Response
 *
 * @param {Function} fetchImpl - Fetch 实现函数
 * @param {Object} request - 请求对象
 * @param {AbortSignal} signal - 取消信号
 * @param {Object} retryOptions - 重试配置
 * @returns {Promise<Response>} Fetch 响应
 */
async function sendAnthropicRequest(fetchImpl, request, signal, retryOptions) {
    return fetchWithRetry(fetchImpl, request.endpoint, {
        method: 'POST',
        headers: request.headers,
        body: JSON.stringify(request.body),
        signal
    }, retryOptions);
}

/**
 * 判断非流式请求是否需要自动切换为流式（Thinking 限制）
 *
 * @param {Object} request - Anthropic 请求对象
 * @returns {boolean} 是否需要自动切换
 */
function shouldAutoSwitchToThinkingStream(request) {
    return request?.body?.thinking?.type === 'enabled'
        && Number.isFinite(request?.body?.max_tokens)
        && request.body.max_tokens > ANTHROPIC_NON_STREAM_THINKING_MAX_TOKENS;
}

/**
 * 提取 SSE 事件中的 data 字段内容
 *
 * 算法：
 * 1. 按行分割事件文本
 * 2. 提取所有以 "data:" 开头的行
 * 3. 移除 "data:" 前缀并合并
 *
 * @param {string} rawEvent - 原始 SSE 事件文本
 * @returns {string} data 字段内容
 */
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
 * 算法：
 * 1. 使用 ReadableStream 的 reader 逐块读取数据
 * 2. 使用 TextDecoder 解码字节流
 * 3. 按双换行符（\n\n 或 \r\n\r\n）分割事件
 * 4. 提取每个事件的 data 字段并解析为 JSON
 * 5. 忽略格式错误的事件
 *
 * @param {Response} response - Fetch API 响应对象
 * @param {AbortSignal} signal - 取消信号
 * @yields {Object} 解析后的 JSON 事件对象
 * @throws {Error} 如果响应体为空或被取消
 */
async function* readSseJsonEvents(response, signal) {
    const stream = response?.body;
    if (!stream || typeof stream.getReader !== 'function') {
        throw new Error('Anthropic stream response body is empty.');
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

                try {
                    yield JSON.parse(rawData);
                } catch {
                    // Ignore malformed payload.
                }
            }
        }

        buffer += decoder.decode();

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

            try {
                yield JSON.parse(rawData);
            } catch {
                // Ignore malformed payload.
            }
        }

        const residualData = extractSseDataPayload(buffer.trim());
        if (residualData) {
            try {
                yield JSON.parse(residualData);
            } catch {
                // Ignore malformed payload.
            }
        }
    } finally {
        reader.releaseLock?.();
    }
}

/**
 * 消费 Anthropic SSE 响应并聚合文本
 *
 * @param {Response} response - Fetch API 响应对象
 * @param {AbortSignal} signal - 取消信号
 * @returns {Promise<string>} 聚合后的文本
 */
async function consumeAnthropicStreamText(response, signal) {
    let text = '';

    for await (const payload of readSseJsonEvents(response, signal)) {
        const streamError = parseAnthropicStreamError(payload);
        if (streamError) {
            throw new Error(streamError);
        }

        const deltaText = parseAnthropicStreamDelta(payload);
        if (!deltaText) {
            continue;
        }

        text += deltaText;
    }

    return text;
}

/**
 * 构建 API 密钥数组
 *
 * 从配置中提取主密钥和备用密钥，过滤空值
 *
 * @param {Object} config - Provider 配置
 * @returns {Array<string>} API 密钥数组
 */
function buildApiKeys(config) {
    return [config.apiKey, config.backupApiKey]
        .map((key) => (typeof key === 'string' ? key.trim() : ''))
        .filter(Boolean);
}

/**
 * 创建 Anthropic Provider 实例
 *
 * @param {Object} options - 创建选项
 * @param {Function} [options.fetchImpl] - Fetch 实现函数（默认使用全局 fetch）
 * @param {number} [options.maxRetries=3] - 最大重试次数
 * @param {number} [options.maxRetryDelayMs=8000] - 最大重试延迟（毫秒）
 * @returns {ChatProvider} Provider 实例
 * @throws {Error} 如果缺少 fetch 实现
 */
export function createAnthropicProvider({
    fetchImpl = globalThis.fetch?.bind(globalThis),
    maxRetries = 3,
    maxRetryDelayMs = 8000
} = {}) {
    if (typeof fetchImpl !== 'function') {
        throw new Error('fetch implementation is required for Anthropic provider.');
    }

    const providerId = CHAT_PROVIDER_IDS.anthropic;

    return {
        id: providerId,
        /**
         * 非流式生成方法
         *
         * 算法：
         * 1. 验证配置和 API 密钥
         * 2. 构建请求封装和请求对象
         * 3. 使用带重试的 fetch 发送请求
         * 4. 如果主密钥失败且有备用密钥，自动切换到备用密钥
         * 5. 解析响应并按标记分割消息
         *
         * @param {ProviderGenerateParams} params - 生成参数
         * @returns {Promise<{segments: string[]}>} 生成结果
         * @throws {Error} 如果请求失败或配置无效
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
                throw new Error('Anthropic model is required.');
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
                    const retryOptions = {
                        maxRetries,
                        maxRetryDelayMs,
                        onRetryNotice
                    };

                    let assistantRawText = '';
                    if (shouldAutoSwitchToThinkingStream(request)) {
                        const streamRequest = buildProviderRequest({
                            providerId,
                            config,
                            envelope: requestEnvelope,
                            stream: true,
                            apiKey: apiKeys[keyIndex]
                        });
                        const streamResponse = await sendAnthropicRequest(
                            fetchImpl,
                            streamRequest,
                            signal,
                            retryOptions
                        );

                        if (!streamResponse.ok) {
                            const details = await readErrorDetails(streamResponse);
                            throw new Error(`HTTP ${streamResponse.status}: ${details}`);
                        }

                        assistantRawText = await consumeAnthropicStreamText(streamResponse, signal);
                    } else {
                        const response = await sendAnthropicRequest(
                            fetchImpl,
                            request,
                            signal,
                            retryOptions
                        );

                        if (!response.ok) {
                            const details = await readErrorDetails(response);
                            throw new Error(`HTTP ${response.status}: ${details}`);
                        }

                        const responseData = await response.json();
                        assistantRawText = parseAnthropicText(responseData);
                    }

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

            throw lastError || new Error('Anthropic request failed.');
        },

        /**
         * 流式生成方法
         *
         * 算法：
         * 1. 验证配置和 API 密钥
         * 2. 构建请求封装和请求对象（stream: true）
         * 3. 使用带重试的 fetch 发送请求
         * 4. 读取 SSE 流并解析文本增量
         * 5. 如果主密钥失败且有备用密钥且未发送任何数据，自动切换到备用密钥
         * 6. 发送完成事件
         *
         * @param {ProviderGenerateParams} params - 生成参数
         * @yields {ProviderStreamEvent} 流式事件
         * @throws {Error} 如果请求失败或配置无效
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
                throw new Error('Anthropic model is required.');
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
                    const response = await sendAnthropicRequest(fetchImpl, request, signal, {
                        maxRetries,
                        maxRetryDelayMs,
                        onRetryNotice
                    });

                    if (!response.ok) {
                        const details = await readErrorDetails(response);
                        throw new Error(`HTTP ${response.status}: ${details}`);
                    }

                    for await (const payload of readSseJsonEvents(response, signal)) {
                        const streamError = parseAnthropicStreamError(payload);
                        if (streamError) {
                            throw new Error(streamError);
                        }

                        if (parseAnthropicReasoningSignal(payload)) {
                            yield { type: 'reasoning' };
                        }

                        const deltaText = parseAnthropicStreamDelta(payload);
                        if (!deltaText) {
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

            throw lastError || new Error('Anthropic stream request failed.');
        }
    };
}


