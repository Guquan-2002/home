/**
 * 消息前缀构建器
 *
 * 职责：
 * - 为用户消息添加可选的时间戳和用户名前缀
 * - 格式化时间戳为标准格式 [YYYY-MM-DD HH:MM:SS]
 * - 格式化用户名标签为中文全角括号 【用户名】
 * - 组合多个前缀标签
 *
 * 依赖：无
 * 被依赖：api-manager
 */

/**
 * 格式化时间戳为前缀格式
 * @param {number|string|Date} timestamp - 时间戳
 * @returns {string} 格式化后的时间戳 [YYYY-MM-DD HH:MM:SS]
 */
// Message prefix helpers: build optional user-name and timestamp prefixes.
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

/**
 * 格式化用户名标签
 * @param {string} name - 用户名
 * @returns {string} 格式化后的用户名标签 【用户名】
 *
 * 处理逻辑：
 * - 移除已有的括号（ASCII [] 或中文 【】）
 * - 使用中文全角括号包裹用户名
 * - 空名称返回空字符串
 */
function formatNameTag(name) {
    const trimmed = typeof name === 'string' ? name.trim() : '';
    if (!trimmed) return '';

    const hasAsciiBrackets = trimmed.startsWith('[') && trimmed.endsWith(']');
    const hasCjkBrackets = trimmed.startsWith('【') && trimmed.endsWith('】');

    const normalized = hasAsciiBrackets || hasCjkBrackets
        ? trimmed.slice(1, -1).trim()
        : trimmed;

    if (!normalized) return '';
    return `【${normalized}】`;
}

/**
 * 构建用户名前缀
 * @param {Object} config - 配置对象
 * @param {boolean} config.prefixWithName - 是否启用用户名前缀
 * @param {string} config.userName - 用户名
 * @returns {string} 用户名前缀或空字符串
 */
export function buildNamePrefix(config) {
    if (!config?.prefixWithName) {
        return '';
    }

    return formatNameTag(config.userName);
}

/**
 * 构建时间戳前缀
 * @param {Object} config - 配置对象
 * @param {boolean} config.prefixWithTime - 是否启用时间戳前缀
 * @param {number|string|Date} timestamp - 时间戳
 * @returns {string} 时间戳前缀或空字符串
 */
export function buildTimestampPrefix(config, timestamp) {
    if (!config?.prefixWithTime) {
        return '';
    }

    return formatPrefixTimestamp(timestamp);
}

/**
 * 构建完整的消息前缀
 * @param {Object} config - 配置对象
 * @returns {string} 组合后的前缀（多个标签用换行分隔）
 *
 * 注意：当前实现只包含用户名前缀，时间戳前缀需要单独调用 buildTimestampPrefix
 */
export function buildMessagePrefix(config) {
    const tags = [];

    const nameTag = buildNamePrefix(config);
    if (nameTag) {
        tags.push(nameTag);
    }

    return tags.join('\n');
}

/**
 * 将前缀应用到消息内容
 * @param {string} content - 原始消息内容
 * @param {string} prefix - 前缀文本
 * @returns {string} 带前缀的消息内容（前缀和内容用换行分隔）
 */
export function applyMessagePrefix(content, prefix) {
    const normalizedContent = typeof content === 'string' ? content : '';
    if (!prefix) {
        return normalizedContent;
    }

    return `${prefix}\n${normalizedContent}`;
}
