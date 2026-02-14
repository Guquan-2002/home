/**
 * OpenAI Chat Completions API 适配器
 *
 * 职责：
 * - 将标准化的本地消息格式转换为 OpenAI Chat Completions API 的请求格式
 * - 处理图片的多种来源类型（url、data_url、base64）
 * - 支持 Reasoning Effort 和 Web Search 功能
 * - 构建完整的 API 请求对象（endpoint、headers、body）
 *
 * 依赖：无
 * 被依赖：format-router.js
 */

/** 转换为修剪后的字符串 */
function asTrimmedString(value) {
    return typeof value === 'string' ? value.trim() : '';
}

/** 规范化 API URL（移除尾部斜杠） */
function normalizeApiUrl(apiUrl) {
    const trimmed = asTrimmedString(apiUrl).replace(/\/+$/, '');
    return trimmed || null;
}

/**
 * 构建端点 URL
 *
 * 如果 baseUrl 已经以 /chat/completions 结尾，直接返回；否则追加该路径
 *
 * @param {string} baseUrl - 基础 URL
 * @returns {string} 完整的端点 URL
 */
function buildEndpoint(baseUrl) {
    return baseUrl.endsWith('/chat/completions') ? baseUrl : `${baseUrl}/chat/completions`;
}

/**
 * 确保图片 URL 值有效
 *
 * 支持的来源类型：
 * - url: 直接返回 URL
 * - data_url: 直接返回 data URL
 * - base64: 转换为 data URL 格式（需要 mimeType）
 *
 * @param {Object} image - 图片对象
 * @returns {string} 图片 URL
 * @throws {Error} 如果图片格式不支持或缺少必要字段
 */
function ensureImageUrlValue(image) {
    if (!image || typeof image !== 'object') {
        throw new Error('OpenAI chat image part is invalid.');
    }

    if (image.sourceType === 'url' || image.sourceType === 'data_url') {
        return image.value;
    }

    if (image.sourceType === 'base64') {
        if (!image.mimeType) {
            throw new Error('OpenAI chat base64 image part requires mimeType.');
        }

        return `data:${image.mimeType};base64,${image.value}`;
    }

    throw new Error(`OpenAI chat does not support image sourceType "${image.sourceType}".`);
}

/**
 * 将本地消息 part 转换为 OpenAI 内容格式
 *
 * @param {Object} part - 本地消息 part
 * @returns {Object|null} OpenAI 格式的内容对象
 */
function toOpenAiContentPart(part) {
    if (part.type === 'text') {
        return {
            type: 'text',
            text: part.text
        };
    }

    if (part.type === 'image') {
        const imageUrl = {
            url: ensureImageUrlValue(part.image)
        };
        if (part.image.detail) {
            imageUrl.detail = part.image.detail;
        }

        return {
            type: 'image_url',
            image_url: imageUrl
        };
    }

    return null;
}

/**
 * 将 parts 数组转换为 OpenAI 消息内容格式
 *
 * 算法：
 * - 如果没有图片，返回纯文本字符串（多个文本用双换行连接）
 * - 如果有图片，返回 parts 数组（保持多模态格式）
 *
 * @param {Array<Object>} parts - 本地消息 parts 数组
 * @returns {string|Array<Object>} OpenAI 消息内容
 */
function toOpenAiMessageContent(parts) {
    const mappedParts = parts
        .map((part) => toOpenAiContentPart(part))
        .filter(Boolean);

    if (mappedParts.length === 0) {
        return '';
    }

    const hasImagePart = mappedParts.some((part) => part.type === 'image_url');
    if (!hasImagePart) {
        return mappedParts.map((part) => part.text).join('\n\n');
    }

    return mappedParts;
}

/**
 * 构建 OpenAI Chat Completions API 请求对象
 *
 * 算法：
 * 1. 验证并规范化 API URL
 * 2. 构建消息数组（系统指令作为第一条消息）
 * 3. 转换消息格式（将 parts 转换为 OpenAI 格式）
 * 4. 添加 Reasoning Effort 和 Web Search 等可选配置
 *
 * @param {Object} options - 构建选项
 * @param {Object} options.config - Provider 配置
 * @param {Object} options.envelope - 消息封装对象
 * @param {boolean} [options.stream=false] - 是否启用流式响应
 * @param {string} options.apiKey - API 密钥
 * @returns {Object} 请求对象 {endpoint, headers, body}
 * @throws {Error} 如果 API URL 缺失
 */
export function buildOpenAiChatCompletionsRequest({
    config,
    envelope,
    stream = false,
    apiKey
}) {
    const baseUrl = normalizeApiUrl(config?.apiUrl);
    if (!baseUrl) {
        throw new Error('OpenAI API URL is required.');
    }

    const endpoint = buildEndpoint(baseUrl);
    const messages = [];

    // 添加系统指令（作为第一条消息）
    if (envelope.systemInstruction) {
        messages.push({
            role: 'system',
            content: envelope.systemInstruction
        });
    }

    // 转换并添加对话消息
    envelope.messages.forEach((message) => {
        messages.push({
            role: message.role === 'assistant' ? 'assistant' : 'user',
            content: toOpenAiMessageContent(message.parts)
        });
    });

    const body = {
        model: config.model,
        messages,
        stream
    };

    // 添加 Reasoning Effort 配置
    if (typeof config?.thinkingBudget === 'string' && config.thinkingBudget) {
        body.reasoning_effort = config.thinkingBudget;
    }

    // 添加 Web Search 配置
    if (
        typeof config?.searchMode === 'string'
        && (config.searchMode === 'openai_web_search' || config.searchMode.startsWith('openai_web_search_'))
    ) {
        body.web_search_options = {};
    }

    return {
        endpoint,
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`
        },
        body
    };
}
