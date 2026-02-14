/**
 * 流式标记分割器
 *
 * 职责：
 * - 根据配置的标记符（marker）分割流式文本
 * - 支持多个标记符同时使用
 * - 维护内部缓冲区，处理跨块的标记符
 * - 提供推送、刷新、丢弃等操作
 *
 * 使用场景：
 * - 分割助手响应中的多个段落（使用 ASSISTANT_SEGMENT_MARKER）
 * - 分割句子（使用 ASSISTANT_SENTENCE_MARKER）
 *
 * 依赖：无
 * 被依赖：anthropic-provider, gemini-provider
 */

/**
 * 规范化标记符数组
 * @param {Array} markers - 原始标记符数组
 * @returns {Array<string>} 规范化后的标记符数组（去重、去空）
 */
// Stream splitter: separates streamed text by configured assistant segment markers.
const LEADING_SENTENCE_PUNCTUATION_REGEX = /^[\u3002.!?\uFF01\uFF1F]+/u;

function normalizeMarkers(markers) {
    if (!Array.isArray(markers)) {
        return [];
    }

    return [...new Set(
        markers
            .filter((marker) => typeof marker === 'string')
            .map((marker) => marker.trim())
            .filter(Boolean)
    )];
}

/**
 * 在缓冲区中查找下一个标记符
 * @param {string} buffer - 缓冲区内容
 * @param {Array<string>} markers - 标记符数组
 * @returns {Object|null} 匹配结果 { index, length } 或 null
 *
 * 策略：
 * - 返回最早出现的标记符
 * - 如果多个标记符在同一位置，返回最长的
 */
function findNextMarker(buffer, markers) {
    let nextMatch = null;

    for (const marker of markers) {
        const index = buffer.indexOf(marker);
        if (index === -1) {
            continue;
        }

        if (!nextMatch || index < nextMatch.index || (index === nextMatch.index && marker.length > nextMatch.length)) {
            nextMatch = {
                index,
                length: marker.length
            };
        }
    }

    return nextMatch;
}

function normalizeSegment(segment) {
    const trimmed = typeof segment === 'string' ? segment.trim() : '';
    if (!trimmed) {
        return '';
    }

    // Some providers may place sentence markers before punctuation, producing a stray leading period.
    return trimmed.replace(LEADING_SENTENCE_PUNCTUATION_REGEX, '').trimStart();
}

/**
 * 创建标记流分割器
 * @param {Object} options - 选项
 * @param {Array<string>} options.markers - 标记符数组（至少需要一个）
 * @returns {Object} 分割器对象 { push, flush, discardRemainder, getBuffer }
 * @throws {Error} 如果没有提供有效的标记符
 *
 * 使用示例：
 * const splitter = createMarkerStreamSplitter({ markers: ['<|CHANGE_ROLE|>'] });
 * const segments = splitter.push('text1<|CHANGE_ROLE|>text2');
 * const remaining = splitter.flush();
 */
export function createMarkerStreamSplitter({ markers = [] } = {}) {
    const activeMarkers = normalizeMarkers(markers);
    if (activeMarkers.length === 0) {
        throw new Error('At least one marker is required for stream splitting.');
    }

    let buffer = '';

    /**
     * 推送新的文本增量
     * @param {string} textDelta - 新增的文本
     * @returns {Array<string>} 提取出的完整段落数组
     */
    function push(textDelta) {
        const safeDelta = typeof textDelta === 'string' ? textDelta : '';
        if (!safeDelta) {
            return [];
        }

        buffer += safeDelta;

        const segments = [];
        while (buffer.length > 0) {
            const nextMarker = findNextMarker(buffer, activeMarkers);
            if (!nextMarker) {
                break;
            }

            const segment = normalizeSegment(buffer.slice(0, nextMarker.index));
            if (segment) {
                segments.push(segment);
            }

            buffer = buffer.slice(nextMarker.index + nextMarker.length);
        }

        return segments;
    }

    /**
     * 刷新缓冲区，返回剩余内容
     * @returns {string} 缓冲区中的剩余内容（已修剪）
     */
    function flush() {
        const remaining = normalizeSegment(buffer);
        buffer = '';
        return remaining;
    }

    /**
     * 丢弃缓冲区中的剩余内容
     */
    function discardRemainder() {
        buffer = '';
    }

    /**
     * 获取当前缓冲区内容（用于调试）
     * @returns {string} 缓冲区内容
     */
    function getBuffer() {
        return buffer;
    }

    return {
        push,
        flush,
        discardRemainder,
        getBuffer
    };
}
