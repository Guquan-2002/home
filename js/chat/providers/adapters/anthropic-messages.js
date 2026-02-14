/**
 * Anthropic Messages API 适配器
 *
 * 职责：
 * - 将标准化的本地消息格式转换为 Anthropic Messages API 的请求格式
 * - 处理图片的多种来源类型（URL、data_url、base64）
 * - 支持 Thinking Budget（思考预算）和 Web Search 功能
 * - 构建完整的 API 请求对象（endpoint、headers、body）
 *
 * 依赖：local-message.js（图片数据解析）
 * 被依赖：format-router.js
 */
import { parseImageDataUrl } from '../../core/local-message.js';

const ANTHROPIC_API_VERSION = '2023-06-01';
const DEFAULT_MAX_TOKENS = 4096;
const MIN_THINKING_BUDGET_TOKENS = 1024;

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
 * 规范化思考预算值
 * @param {*} rawValue - 原始值
 * @returns {number|null} 有效的思考预算值或 null
 */
function normalizeThinkingBudget(rawValue) {
    const parsed = Number.parseInt(rawValue, 10);
    if (!Number.isFinite(parsed) || parsed < MIN_THINKING_BUDGET_TOKENS) {
        return null;
    }

    return parsed;
}

/**
 * 解析最大 Token 数
 *
 * 算法：
 * - 如果设置了思考预算，返回 max(4096, thinkingBudget + 1024)
 * - 否则使用配置中的 maxTokens，默认 4096
 *
 * @param {Object} config - Provider 配置
 * @param {number|null} thinkingBudget - 思考预算
 * @returns {number} 最大 Token 数
 */
function resolveMaxTokens(config, thinkingBudget) {
    if (thinkingBudget) {
        return Math.max(DEFAULT_MAX_TOKENS, thinkingBudget + 1024);
    }

    const parsed = Number.parseInt(config?.maxTokens, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
        return parsed;
    }

    return DEFAULT_MAX_TOKENS;
}

/**
 * 将本地消息 part 转换为 Anthropic 内容格式
 *
 * 支持的类型：
 * - text: 文本内容
 * - image: 图片（支持 url、data_url、base64 三种来源）
 *
 * @param {Object} part - 本地消息 part
 * @returns {Object|null} Anthropic 格式的内容对象
 * @throws {Error} 如果图片格式不支持
 */
function toAnthropicContentPart(part) {
    if (part.type === 'text') {
        return {
            type: 'text',
            text: part.text
        };
    }

    if (part.type === 'image') {
        if (part.image.sourceType === 'url') {
            return {
                type: 'image',
                source: {
                    type: 'url',
                    url: part.image.value
                }
            };
        }

        if (part.image.sourceType === 'data_url') {
            const parsedDataUrl = parseImageDataUrl(part.image.value);
            if (!parsedDataUrl) {
                throw new Error('Anthropic image data_url must be a valid base64 data URL.');
            }

            return {
                type: 'image',
                source: {
                    type: 'base64',
                    media_type: parsedDataUrl.mimeType,
                    data: parsedDataUrl.data
                }
            };
        }

        if (part.image.sourceType === 'base64') {
            if (!part.image.mimeType) {
                throw new Error('Anthropic base64 image part requires mimeType.');
            }

            return {
                type: 'image',
                source: {
                    type: 'base64',
                    media_type: part.image.mimeType,
                    data: part.image.value
                }
            };
        }

        throw new Error(`Anthropic does not support image sourceType "${part.image.sourceType}".`);
    }

    return null;
}

/**
 * 构建 Anthropic Messages API 请求对象
 *
 * 算法：
 * 1. 验证并规范化 API URL
 * 2. 解析思考预算和最大 Token 数
 * 3. 转换消息格式（将 parts 转换为 Anthropic 格式）
 * 4. 添加系统指令、思考预算、搜索工具等可选配置
 *
 * @param {Object} options - 构建选项
 * @param {Object} options.config - Provider 配置
 * @param {Object} options.envelope - 消息封装对象
 * @param {boolean} [options.stream=false] - 是否启用流式响应
 * @param {string} options.apiKey - API 密钥
 * @returns {Object} 请求对象 {endpoint, headers, body}
 * @throws {Error} 如果 API URL 缺失
 */
export function buildAnthropicMessagesRequest({
    config,
    envelope,
    stream = false,
    apiKey
}) {
    const baseUrl = normalizeApiUrl(config?.apiUrl);
    if (!baseUrl) {
        throw new Error('Anthropic API URL is required.');
    }

    const thinkingBudget = normalizeThinkingBudget(config?.thinkingBudget);
    const body = {
        model: config.model,
        max_tokens: resolveMaxTokens(config, thinkingBudget),
        stream,
        messages: envelope.messages.map((message) => ({
            role: message.role === 'assistant' ? 'assistant' : 'user',
            content: message.parts
                .map((part) => toAnthropicContentPart(part))
                .filter(Boolean)
        }))
    };

    // 添加系统指令
    if (envelope.systemInstruction) {
        body.system = envelope.systemInstruction;
    }

    // 添加思考预算配置
    if (thinkingBudget) {
        body.thinking = {
            type: 'enabled',
            budget_tokens: thinkingBudget
        };
    }

    // 添加 Web Search 工具
    if (config?.searchMode === 'anthropic_web_search') {
        body.tools = [{
            type: 'web_search_20250305',
            name: 'web_search'
        }];
    }

    return {
        endpoint: `${baseUrl}/messages`,
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': ANTHROPIC_API_VERSION
        },
        body
    };
}
