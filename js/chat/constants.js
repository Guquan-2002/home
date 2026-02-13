export const CHAT_STORAGE_KEY = 'llm_chat_config';
export const CHAT_HISTORY_KEY = 'llm_chat_history_v2';
export const CHAT_SCHEMA_VERSION = 2;
export const SOURCES_MARKDOWN_MARKER = '\n\n---\n**Sources**\n';
export const ASSISTANT_SEGMENT_MARKER = '<|CHANGE_ROLE|>';

export const CHAT_LIMITS = Object.freeze({
    maxContextTokens: 200000,
    maxContextMessages: 120,
    maxRenderedMessages: 1000,
    connectTimeoutMs: 30000,
    maxRetries: 3
});

export const GEMINI_DEFAULTS = Object.freeze({
    provider: 'gemini',
    apiUrl: 'https://generativelanguage.googleapis.com/v1beta',
    systemPrompt: 'You are a helpful assistant.',
    searchMode: '',
    thinkingBudget: null,
    prefixWithTime: false,
    prefixWithName: false,
    userName: 'User'
});
