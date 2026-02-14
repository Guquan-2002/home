/**
 * Gemini Provider 客户端
 *
 * 职责：
 * - 实现 Gemini GenerateContent API 的完整调用逻辑
 * - 处理请求重试（指数退避算法）
 * - 支持备用 API 密钥的自动切换
 * - 解析 SSE 流式响应和非流式响应
 * - 处理 Gemini 特有的增量文本合并逻辑
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

/** 判断 HTTP 状态码是否应该重试 */
function shouldRetryStatus(statusCode) {
    return statusCode === 408 || statusCode === 429 || statusCode >= 500;
}

/**
 * 解析 Gemini 响应中的文本内容
 *
 * 从 candidates[0].content.parts 中提取所有文本
 *
 * @param {Object} responseData - Gemini API 响应数据
 * @returns {string} 提取的文本内容
 */
function parseGeminiText(responseData) {
    const parts = responseData?.candidates?.[0]?.content?.parts;
    if (!Array.isArray(parts)) {
        return '';
    }

    return parts
        .map((part) => (typeof part?.text === 'string' ? part.text : ''))
        .filter(Boolean)
        .join('');
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
 * - 处理流结束后的残留数据
 *
 * @param {Response} response - Fetch API 响应对象
 * @param {AbortSignal} signal - 取消信号
 * @yields {Object} 解析后的 JSON 事件对象
 */
async function* readSseJsonEvents(response, signal) {
    const stream = response?.body;
    if (!stream || typeof stream.getReader !== 'function') {
        throw new Error('Gemini stream response body is empty.');
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
                if (!rawData || rawData === '[DONE]') {
                    if (rawData === '[DONE]') {
                        return;
                    }
                    continue;
                }

                try {
                    yield JSON.parse(rawData);
                } catch {
                    // Ignore malformed SSE payloads.
                }
            }
        }

        buffer += decoder.decode();
        const residualData = extractSseDataPayload(buffer.trim());
        if (residualData && residualData !== '[DONE]') {
            try {
                yield JSON.parse(residualData);
            } catch {
                // Ignore malformed residual payload.
            }
        }
    } finally {
        reader.releaseLock?.();
    }
}

/**
 * 解析流式响应的文本增量
 *
 * Gemini 的流式响应可能返回完整文本而非增量，需要计算差异：
 * - 如果新文本以已组装文本开头，返回增量部分
 * - 如果已组装文本包含新文本，忽略（重复数据）
 * - 否则直接追加新文本
 *
 * @param {string} nextText - 新接收的文本
 * @param {string} assembledText - 已组装的文本
 * @returns {{deltaText: string, mergedText: string}} 增量文本和合并后的文本
 */
function resolveStreamDelta(nextText, assembledText) {
    if (!nextText) {
        return {
            deltaText: '',
            mergedText: assembledText
        };
    }

    if (!assembledText) {
        return {
            deltaText: nextText,
            mergedText: nextText
        };
    }

    if (nextText.startsWith(assembledText)) {
        return {
            deltaText: nextText.slice(assembledText.length),
            mergedText: nextText
        };
    }

    if (assembledText.startsWith(nextText) || assembledText.endsWith(nextText)) {
        return {
            deltaText: '',
            mergedText: assembledText
        };
    }

    return {
        deltaText: nextText,
        mergedText: `${assembledText}${nextText}`
    };
}

/** 构建 API 密钥数组（同 Anthropic） */
function buildApiKeys(config) {
    return [config.apiKey, config.backupApiKey]
        .map((key) => (typeof key === 'string' ? key.trim() : ''))
        .filter(Boolean);
}

/**
 * 创建 Gemini Provider 实例
 *
 * @param {Object} options - 创建选项
 * @param {Function} [options.fetchImpl] - Fetch 实现函数
 * @param {number} [options.maxRetries=3] - 最大重试次数
 * @param {number} [options.maxRetryDelayMs=8000] - 最大重试延迟（毫秒）
 * @returns {ChatProvider} Provider 实例
 */
export function createGeminiProvider({
    fetchImpl = globalThis.fetch?.bind(globalThis),
    maxRetries = 3,
    maxRetryDelayMs = 8000
} = {}) {
    if (typeof fetchImpl !== 'function') {
        throw new Error('fetch implementation is required for Gemini provider.');
    }

    const providerId = CHAT_PROVIDER_IDS.gemini;

    return {
        id: providerId,
        /** 非流式生成方法（逻辑同 Anthropic） */
        async generate({
            config,
            contextMessages,
            localMessageEnvelope,
            signal,
            onRetryNotice,
            onFallbackKey
        }) {
            if (!config?.model) {
                throw new Error('Gemini model is required.');
            }

            const apiKeys = buildApiKeys(config);

            if (!apiKeys.length) {
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
                    const assistantRawText = parseGeminiText(responseData);

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

            throw lastError || new Error('Gemini request failed.');
        },

        /**
         * 流式生成方法
         *
         * 与 Anthropic 的区别：
         * - 使用 resolveStreamDelta 处理增量文本合并
         * - 维护 assembledText 状态来计算增量
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
                throw new Error('Gemini model is required.');
            }

            const apiKeys = buildApiKeys(config);
            if (!apiKeys.length) {
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
                let assembledText = '';

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

                    for await (const payload of readSseJsonEvents(response, signal)) {
                        const streamText = parseGeminiText(payload);
                        const deltaResult = resolveStreamDelta(streamText, assembledText);
                        assembledText = deltaResult.mergedText;

                        if (!deltaResult.deltaText) {
                            continue;
                        }

                        emittedAnyDelta = true;
                        yield {
                            type: 'text-delta',
                            text: deltaResult.deltaText
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

            throw lastError || new Error('Gemini stream request failed.');
        }
    };
}




