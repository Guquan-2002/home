/**
 * OpenAI Responses API 适配器
 *
 * 职责：
 * - 将标准化的本地消息格式转换为 OpenAI Responses API 的请求格式
 * - 处理图片的多种来源类型（url、data_url、base64、file_id）
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
 * 如果 baseUrl 已经以 /responses 结尾，直接返回；否则追加该路径
 *
 * @param {string} baseUrl - 基础 URL
 * @returns {string} 完整的端点 URL
 */
function buildEndpoint(baseUrl) {
    return baseUrl.endsWith('/responses') ? baseUrl : `${baseUrl}/responses`;
}

/**
 * 将图片对象转换为 Responses API 的图片 URL
 *
 * 支持的来源类型：
 * - url: 直接返回 URL
 * - data_url: 直接返回 data URL
 * - base64: 转换为 data URL 格式（需要 mimeType）
 *
 * @param {Object} image - 图片对象
 * @returns {string} 图片 URL
 * @throws {Error} 如果缺少必要字段
 */
function toResponsesImageUrl(image) {
    if (!image || typeof image !== 'object') {
        throw new Error('OpenAI Responses image part is invalid.');
    }

    if (image.sourceType === 'url' || image.sourceType === 'data_url') {
        return image.value;
    }

    if (image.sourceType === 'base64') {
        if (!image.mimeType) {
            throw new Error('OpenAI Responses base64 image part requires mimeType.');
        }

        return `data:${image.mimeType};base64,${image.value}`;
    }

    return '';
}

/**
 * 将本地消息 part 转换为 Responses API 的输入内容格式
 *
 * 支持的类型：
 * - text: 转换为 input_text
 * - image: 转换为 input_image（支持 file_id 或 image_url）
 *
 * @param {Object} part - 本地消息 part
 * @returns {Object|null} Responses API 格式的内容对象
 * @throws {Error} 如果图片格式不支持
 */
function toInputContentPart(part) {
    if (part.type === 'text') {
        return {
            type: 'input_text',
            text: part.text
        };
    }

    if (part.type === 'image') {
        const contentPart = {
            type: 'input_image'
        };

        if (part.image.sourceType === 'file_id') {
            contentPart.file_id = part.image.value;
        } else {
            const imageUrl = toResponsesImageUrl(part.image);
            if (!imageUrl) {
                throw new Error(`OpenAI Responses does not support image sourceType "${part.image.sourceType}".`);
            }
            contentPart.image_url = imageUrl;
        }

        if (part.image.detail) {
            contentPart.detail = part.image.detail;
        }

        return contentPart;
    }

    return null;
}

/**
 * 构建 OpenAI Responses API 请求对象
 *
 * 算法：
 * 1. 验证并规范化 API URL
 * 2. 转换消息格式（将 parts 转换为 Responses API 的 input 格式）
 * 3. 添加系统指令（instructions 字段）
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
export function buildOpenAiResponsesRequest({
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
    // 转换消息为 Responses API 的 input 格式
    const input = envelope.messages.map((message) => ({
        type: 'message',
        role: message.role === 'assistant' ? 'assistant' : 'user',
        content: message.parts
            .map((part) => toInputContentPart(part))
            .filter(Boolean)
    }));

    const body = {
        model: config.model,
        input,
        stream
    };

    // 添加系统指令
    if (envelope.systemInstruction) {
        body.instructions = envelope.systemInstruction;
    }

    // 添加 Reasoning Effort 配置
    if (typeof config?.thinkingBudget === 'string' && config.thinkingBudget) {
        body.reasoning = {
            effort: config.thinkingBudget
        };
    }

    // 添加 Web Search 工具
    if (typeof config?.searchMode === 'string' && config.searchMode.startsWith('openai_web_search_')) {
        const contextSize = config.searchMode.replace('openai_web_search_', '');
        body.tools = [{
            type: 'web_search_preview',
            search_context_size: contextSize
        }];
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
