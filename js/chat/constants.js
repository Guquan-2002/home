/**
 * 聊天模块常量定义
 *
 * 职责：
 * - 定义所有共享的常量（存储键、Provider ID、默认配置、运行时限制）
 * - 作为整个 chat 模块的基础层，被所有其他模块依赖
 *
 * 依赖：无
 * 被依赖：几乎所有 chat 模块
 */

// localStorage 存储键
export const CHAT_STORAGE_KEY = 'llm_chat_config';
export const CHAT_HISTORY_KEY = 'llm_chat_history_v2';
export const CHAT_DRAFTS_KEY = 'llm_chat_drafts_v1';

// 历史记录 schema 版本号
export const CHAT_SCHEMA_VERSION = 3;

// Markdown 和流式响应标记符
export const SOURCES_MARKDOWN_MARKER = '\n\n---\n**Sources**\n'; // 来源部分标记
export const ASSISTANT_SEGMENT_MARKER = '<|CHANGE_ROLE|>'; // 段落分隔标记
export const ASSISTANT_SENTENCE_MARKER = '<|END_SENTENCE|>'; // 句子结束标记

// AI Provider ID 枚举
export const CHAT_PROVIDER_IDS = Object.freeze({
    gemini: 'gemini',
    openai: 'openai',
    openaiResponses: 'openai_responses',
    arkResponses: 'ark_responses',
    anthropic: 'anthropic'
});

// 运行时限制配置
export const CHAT_LIMITS = Object.freeze({
    maxContextTokens: 200000,      // 最大上下文 Token 数
    maxContextMessages: 120,        // 最大上下文消息数
    maxRenderedMessages: 1000,      // 最大渲染消息数
    connectTimeoutMs: 30000,        // 连接超时时间（毫秒）
    maxRetries: 3                   // 最大重试次数
});

// 所有 Provider 的通用默认配置
const COMMON_CHAT_DEFAULTS = Object.freeze({
    systemPrompt: 'You are a helpful assistant.',
    searchMode: '',
    thinkingBudget: null,
    enablePseudoStream: true,       // 启用伪流式渲染
    enableDraftAutosave: true,      // 启用草稿自动保存
    prefixWithTime: false,          // 消息前缀包含时间戳
    prefixWithName: false,          // 消息前缀包含用户名
    userName: 'User'
});

// Gemini Provider 默认配置
export const GEMINI_DEFAULTS = Object.freeze({
    provider: CHAT_PROVIDER_IDS.gemini,
    apiUrl: 'https://generativelanguage.googleapis.com/v1beta',
    model: 'gemini-3-pro-preview',
    ...COMMON_CHAT_DEFAULTS,
    thinkingLevel: null
});

// OpenAI Chat Completions Provider 默认配置
export const OPENAI_DEFAULTS = Object.freeze({
    provider: CHAT_PROVIDER_IDS.openai,
    apiUrl: 'https://api.openai.com/v1',
    model: 'gpt-5',
    ...COMMON_CHAT_DEFAULTS
});

// OpenAI Responses Provider 默认配置
export const OPENAI_RESPONSES_DEFAULTS = Object.freeze({
    provider: CHAT_PROVIDER_IDS.openaiResponses,
    apiUrl: 'https://api.openai.com/v1',
    model: 'gpt-5',
    ...COMMON_CHAT_DEFAULTS
});

// Volcengine Ark Responses Provider 默认配置
export const ARK_RESPONSES_DEFAULTS = Object.freeze({
    provider: CHAT_PROVIDER_IDS.arkResponses,
    apiUrl: 'https://ark.cn-beijing.volces.com/api/v3/responses',
    model: 'doubao-seed-2-0-pro-260215',
    ...COMMON_CHAT_DEFAULTS
});

// Anthropic Provider 默认配置
export const ANTHROPIC_DEFAULTS = Object.freeze({
    provider: CHAT_PROVIDER_IDS.anthropic,
    apiUrl: 'https://api.anthropic.com/v1',
    model: 'claude-sonnet-4-5-20250929',
    ...COMMON_CHAT_DEFAULTS,
    thinkingEffort: null
});

// 全局默认配置（默认使用 Gemini）
export const CHAT_DEFAULTS = Object.freeze({
    ...GEMINI_DEFAULTS
});

/**
 * 根据 Provider ID 获取对应的默认配置
 * @param {string} providerId - Provider ID
 * @returns {Object} Provider 默认配置对象
 */
export function getProviderDefaults(providerId) {
    if (providerId === CHAT_PROVIDER_IDS.openai) {
        return OPENAI_DEFAULTS;
    }

    if (providerId === CHAT_PROVIDER_IDS.openaiResponses) {
        return OPENAI_RESPONSES_DEFAULTS;
    }

    if (providerId === CHAT_PROVIDER_IDS.arkResponses) {
        return ARK_RESPONSES_DEFAULTS;
    }

    if (providerId === CHAT_PROVIDER_IDS.anthropic) {
        return ANTHROPIC_DEFAULTS;
    }

    return GEMINI_DEFAULTS;
}
