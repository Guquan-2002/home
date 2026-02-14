/**
 * 伪流式渲染工具
 *
 * 职责：
 * - 将完整文本分割为增量块，模拟打字机效果
 * - 智能识别句子和子句边界，避免在词语中间断开
 * - 根据剩余文本长度动态调整块大小
 * - 根据标点符号类型调整延迟时间（句号延迟更长）
 * - 支持中断信号（AbortSignal）
 *
 * 依赖：无
 * 被依赖：ui-manager, session-store
 */

// Pseudo stream helpers: split full text into incremental chunks for typing-like rendering.
// 句子结束标点（中英文）
const SENTENCE_PUNCTUATION_REGEX = /[。！？!?]/u;
// 子句标点（逗号、分号、冒号等）
const CLAUSE_PUNCTUATION_REGEX = /[，,；;：:]/u;
// 边界字符（空白符）
const BOUNDARY_REGEX = /[\s\n\r\t]/u;

/**
 * 根据剩余文本长度决定块大小
 * @param {number} remainingLength - 剩余文本长度
 * @returns {number} 块大小（字符数）
 *
 * 策略：文本越长，块越大，加快渲染速度
 */
function resolveChunkSize(remainingLength) {
    if (remainingLength <= 24) return 1;
    if (remainingLength <= 80) return 2;
    if (remainingLength <= 200) return 4;
    if (remainingLength <= 500) return 6;
    if (remainingLength <= 1000) return 8;
    return 12;
}

/**
 * 查找块的边界位置（避免在词语中间断开）
 * @param {string} text - 完整文本
 * @param {number} startIndex - 起始位置
 * @param {number} targetIndex - 目标位置
 * @param {number} lookahead - 向前查找的字符数
 * @returns {number} 边界位置索引
 *
 * 查找策略：
 * 1. 优先在目标位置后查找标点符号（句号、逗号、换行等）
 * 2. 如果没找到，向前查找空白符
 * 3. 如果都没找到，使用目标位置
 */
function findChunkBoundary(text, startIndex, targetIndex, lookahead) {
    const safeTargetIndex = Math.min(text.length, Math.max(startIndex + 1, targetIndex));
    const searchEnd = Math.min(text.length, safeTargetIndex + lookahead);

    for (let index = safeTargetIndex; index < searchEnd; index += 1) {
        const char = text[index];
        if (SENTENCE_PUNCTUATION_REGEX.test(char) || CLAUSE_PUNCTUATION_REGEX.test(char) || char === '\n') {
            return index + 1;
        }
    }

    for (let index = safeTargetIndex - 1; index > startIndex; index -= 1) {
        if (BOUNDARY_REGEX.test(text[index])) {
            return index + 1;
        }
    }

    return safeTargetIndex;
}

/**
 * 将文本分割为伪流式块
 * @param {string} text - 完整文本
 * @param {Object} options - 选项
 * @param {number} options.lookahead - 向前查找边界的字符数（默认 8）
 * @returns {Array<string>} 文本块数组
 *
 * 算法：
 * 1. 根据剩余长度动态调整块大小
 * 2. 在合适的边界位置切分文本
 * 3. 避免在词语中间断开
 */
export function buildPseudoStreamChunks(text, {
    lookahead = 8
} = {}) {
    const normalizedText = typeof text === 'string' ? text : '';
    if (!normalizedText) {
        return [];
    }

    const chunks = [];
    let cursor = 0;

    while (cursor < normalizedText.length) {
        const remainingLength = normalizedText.length - cursor;
        const chunkSize = resolveChunkSize(remainingLength);
        const targetIndex = cursor + chunkSize;
        const endIndex = findChunkBoundary(normalizedText, cursor, targetIndex, lookahead);
        const chunk = normalizedText.slice(cursor, endIndex);

        if (!chunk) {
            break;
        }

        chunks.push(chunk);
        cursor = endIndex;
    }

    return chunks;
}

/**
 * 根据块内容决定延迟时间
 * @param {string} chunk - 文本块
 * @param {number} baseDelayMs - 基础延迟时间（毫秒）
 * @returns {number} 实际延迟时间（毫秒）
 *
 * 策略：
 * - 句子结束标点：基础延迟 + 35ms
 * - 子句标点或换行：基础延迟 + 20ms
 * - 其他：基础延迟
 */
function resolveChunkDelayMs(chunk, baseDelayMs) {
    const trimmed = chunk.trimEnd();
    if (!trimmed) {
        return baseDelayMs;
    }

    const lastChar = trimmed[trimmed.length - 1];
    if (SENTENCE_PUNCTUATION_REGEX.test(lastChar)) {
        return baseDelayMs + 35;
    }

    if (CLAUSE_PUNCTUATION_REGEX.test(lastChar) || lastChar === '\n') {
        return baseDelayMs + 20;
    }

    return baseDelayMs;
}

/**
 * 等待指定的延迟时间（支持中断）
 * @param {number} delayMs - 延迟时间（毫秒）
 * @param {AbortSignal} signal - 中断信号
 * @returns {Promise<boolean>} 是否应该继续（false 表示被中断）
 */
async function waitForChunkDelay(delayMs, signal) {
    if (!Number.isFinite(delayMs) || delayMs <= 0) {
        return !signal?.aborted;
    }

    if (signal?.aborted) {
        return false;
    }

    return new Promise((resolve) => {
        const timeoutId = setTimeout(() => {
            if (signal) {
                signal.removeEventListener('abort', onAbort);
            }
            resolve(true);
        }, delayMs);

        const onAbort = () => {
            clearTimeout(timeoutId);
            if (signal) {
                signal.removeEventListener('abort', onAbort);
            }
            resolve(false);
        };

        if (signal) {
            signal.addEventListener('abort', onAbort, { once: true });
        }
    });
}

/**
 * 运行伪流式渲染
 * @param {Object} options - 选项
 * @param {string} options.text - 要渲染的完整文本
 * @param {AbortSignal} options.signal - 中断信号（可选）
 * @param {number} options.baseDelayMs - 基础延迟时间（默认 20ms）
 * @param {number} options.lookahead - 边界查找范围（默认 8）
 * @param {Function} options.onProgress - 进度回调函数 (renderedText, chunk) => void
 * @returns {Promise<Object>} 渲染结果
 *
 * 返回格式：
 * {
 *   renderedText: string,   // 已渲染的文本
 *   interrupted: boolean,   // 是否被中断
 *   chunkCount: number      // 总块数
 * }
 */
export async function runPseudoStream({
    text,
    signal = null,
    baseDelayMs = 20,
    lookahead = 8,
    onProgress = null
}) {
    const chunks = buildPseudoStreamChunks(text, { lookahead });
    let renderedText = '';

    for (const chunk of chunks) {
        if (signal?.aborted) {
            return { renderedText, interrupted: true, chunkCount: chunks.length };
        }

        renderedText += chunk;
        if (typeof onProgress === 'function') {
            onProgress(renderedText, chunk);
        }

        const shouldContinue = await waitForChunkDelay(resolveChunkDelayMs(chunk, baseDelayMs), signal);
        if (!shouldContinue) {
            return { renderedText, interrupted: true, chunkCount: chunks.length };
        }
    }

    return { renderedText, interrupted: false, chunkCount: chunks.length };
}
