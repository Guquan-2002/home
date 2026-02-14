/**
 * 消息模型工具集
 *
 * 职责：
 * - 定义聊天消息的数据结构和规范化逻辑
 * - 提供消息创建、克隆、Token 估算、内容提取等核心功能
 * - 处理消息的显示内容、上下文内容、元数据等
 * - 支持按标记分割助手消息（用于伪流式渲染）
 *
 * 依赖：constants.js（标记符常量）
 * 被依赖：api-manager, session-store, context-window, history-storage, anthropic-provider
 */
import {
    ASSISTANT_SEGMENT_MARKER,
    ASSISTANT_SENTENCE_MARKER,
    SOURCES_MARKDOWN_MARKER
} from '../constants.js';

// 默认会话标题
export const DEFAULT_SESSION_TITLE = 'New chat';

// 有效的消息角色（用于 API 请求）
const VALID_ROLES = new Set(['user', 'assistant']);

// 有效的显示角色（用于 UI 展示）
const VALID_DISPLAY_ROLES = new Set(['system', 'assistant', 'user', 'error']);

/**
 * 将值转换为修剪后的字符串
 */
function asTrimmedString(value) {
    return typeof value === 'string' ? value.trim() : '';
}

/**
 * 创建带前缀的唯一 ID
 * @param {string} prefix - ID 前缀
 * @returns {string} 唯一 ID
 */
export function createEntityId(prefix) {
    if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
        return `${prefix}_${globalThis.crypto.randomUUID()}`;
    }

    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * 创建消息 ID
 */
export function createMessageId() {
    return createEntityId('msg');
}

/**
 * 创建轮次 ID（用于标识一次用户输入及其对应的助手回复）
 */
export function createTurnId() {
    return createEntityId('turn');
}

/**
 * 估算文本的 Token 数量
 *
 * 算法：
 * - 中日韩字符：每 1.5 个字符约等于 1 个 token
 * - 其他字符：每 4 个字符约等于 1 个 token
 *
 * @param {string} text - 要估算的文本
 * @returns {number} 估算的 Token 数量
 */
export function estimateTokenCount(text) {
    const safeText = typeof text === 'string' ? text : '';
    const cjkChars = (safeText.match(/[\u4e00-\u9fff\u3000-\u303f]/g) || []).length;
    const otherChars = safeText.length - cjkChars;
    return Math.ceil(cjkChars / 1.5 + otherChars / 4);
}

/**
 * 移除文本中的来源部分（Sources section）
 *
 * 某些 AI 会在回复末尾添加来源引用，此函数用于移除这部分内容
 *
 * @param {string} text - 原始文本
 * @returns {string} 移除来源部分后的文本
 */
export function stripSourcesSection(text) {
    if (typeof text !== 'string') return '';

    const sourcesIndex = text.lastIndexOf(SOURCES_MARKDOWN_MARKER);
    if (sourcesIndex === -1) {
        return text;
    }

    return text.slice(0, sourcesIndex).trimEnd();
}

/**
 * 按标记分割助手消息
 *
 * 用于伪流式渲染：将助手的完整回复按标记分割成多个段落，
 * 前端可以逐段渲染，模拟流式输出效果
 *
 * 标记类型：
 * - ASSISTANT_SEGMENT_MARKER: 段落分隔标记
 * - ASSISTANT_SENTENCE_MARKER: 句子结束标记
 *
 * @param {string} text - 助手消息文本
 * @param {Object} options - 选项
 * @param {boolean} options.enableMarkerSplit - 是否启用标记分割
 * @returns {string[]} 分割后的段落数组
 */
export function splitAssistantMessageByMarker(text, {
    enableMarkerSplit = false
} = {}) {
    const rawText = typeof text === 'string' ? text : '';

    if (!enableMarkerSplit) {
        const fallbackText = rawText.trim();
        if (fallbackText) {
            return [fallbackText];
        }

        return ['(No response text)'];
    }

    const segments = rawText
        .split(ASSISTANT_SEGMENT_MARKER)
        .flatMap((segment) => segment.split(ASSISTANT_SENTENCE_MARKER))
        .map((segment) => segment.trim())
        .filter(Boolean);

    if (segments.length > 0) {
        return segments;
    }

    const fallback = rawText.trim();
    if (fallback) {
        return [fallback];
    }

    return ['(No response text)'];
}

/**
 * 规范化显示角色
 */
function normalizeDisplayRole(displayRole, fallbackRole) {
    if (VALID_DISPLAY_ROLES.has(displayRole)) {
        return displayRole;
    }

    if (fallbackRole === 'assistant' || fallbackRole === 'user') {
        return fallbackRole;
    }

    return '';
}

/**
 * 规范化消息核心数据
 * 提取并验证消息的基本字段（role、content、meta）
 */
function normalizeMessageCore(rawMessage) {
    if (!rawMessage || !VALID_ROLES.has(rawMessage.role)) {
        return null;
    }

    const rawMeta = rawMessage.meta && typeof rawMessage.meta === 'object' ? rawMessage.meta : {};
    const rawContent = typeof rawMessage.content === 'string' ? rawMessage.content : '';
    const fallbackDisplay = typeof rawMeta.displayContent === 'string' ? rawMeta.displayContent : '';

    const normalizedContent = rawMessage.role === 'assistant'
        ? stripSourcesSection(rawContent || fallbackDisplay).trim()
        : (rawContent || fallbackDisplay).trim();

    if (!normalizedContent) {
        return null;
    }

    const normalizedDisplayContent = rawMessage.role === 'assistant'
        ? stripSourcesSection(fallbackDisplay || rawContent)
        : (fallbackDisplay || rawContent);

    return {
        role: rawMessage.role,
        content: normalizedContent,
        rawMeta,
        displayContent: normalizedDisplayContent
    };
}

/**
 * 构建消息元数据对象
 *
 * 元数据包含：
 * - messageId: 消息唯一 ID
 * - turnId: 轮次 ID（一次对话包含用户消息和助手回复）
 * - createdAt: 创建时间戳
 * - tokenEstimate: Token 估算值
 * - displayContent: 显示内容（可能与 content 不同，用于 UI 展示）
 * - contextContent: 上下文内容（用于发送给 AI 的内容）
 * - parts: 多模态消息部分（文本+图片）
 * - displayRole: 显示角色（用于特殊消息类型，如系统消息、错误消息）
 * - isPrefixMessage: 是否为前缀消息（如时间戳、用户名）
 * - prefixType: 前缀类型
 * - interrupted: 是否被中断（用户点击停止按钮）
 *
 * @param {string} content - 消息内容
 * @param {Object} options - 元数据选项
 * @returns {Object} 元数据对象
 */
export function buildMessageMeta(content, {
    messageId = '',
    turnId = '',
    displayContent = '',
    contextContent = '',
    parts = null,
    createdAt = Date.now(),
    tokenEstimate = null,
    displayRole = '',
    isPrefixMessage = false,
    prefixType = '',
    interrupted = false
} = {}) {
    const normalizedContent = typeof content === 'string' ? content : '';
    const normalizedContextContent = asTrimmedString(contextContent);
    const contextForTokenEstimate = normalizedContextContent || normalizedContent;
    const computedTokenEstimate = Number.isFinite(tokenEstimate) && tokenEstimate > 0
        ? tokenEstimate
        : estimateTokenCount(contextForTokenEstimate) + 4;

    const meta = {
        messageId: asTrimmedString(messageId),
        turnId: asTrimmedString(turnId),
        createdAt: Number.isFinite(createdAt) && createdAt > 0 ? createdAt : Date.now(),
        tokenEstimate: computedTokenEstimate
    };

    const normalizedDisplayContent = typeof displayContent === 'string' ? displayContent : '';
    if (normalizedDisplayContent && normalizedDisplayContent !== normalizedContent) {
        meta.displayContent = normalizedDisplayContent;
    }

    if (normalizedContextContent && normalizedContextContent !== normalizedContent) {
        meta.contextContent = normalizedContextContent;
    }

    if (Array.isArray(parts) && parts.length > 0) {
        meta.parts = parts.map((part) => {
            if (!part || typeof part !== 'object') {
                return null;
            }

            return JSON.parse(JSON.stringify(part));
        }).filter(Boolean);
    }

    const normalizedDisplayRole = normalizeDisplayRole(displayRole, '');
    if (normalizedDisplayRole) {
        meta.displayRole = normalizedDisplayRole;
    }

    if (isPrefixMessage === true) {
        meta.isPrefixMessage = true;
    }

    const normalizedPrefixType = asTrimmedString(prefixType);
    if (normalizedPrefixType) {
        meta.prefixType = normalizedPrefixType;
    }

    if (interrupted === true) {
        meta.interrupted = true;
    }

    return meta;
}

/**
 * 创建新的聊天消息
 *
 * 这是创建消息的主要入口函数，会自动：
 * - 生成 messageId 和 turnId（如果未提供）
 * - 规范化内容（移除来源部分、修剪空白）
 * - 构建完整的元数据
 * - 验证角色和内容的有效性
 *
 * @param {Object} params - 消息参数
 * @param {string} params.role - 消息角色（'user' 或 'assistant'）
 * @param {string} params.content - 消息内容
 * @param {string} params.turnId - 轮次 ID（可选）
 * @param {string} params.id - 消息 ID（可选）
 * @param {Object} params.metaOptions - 元数据选项（可选）
 * @returns {Object} 完整的消息对象
 * @throws {Error} 如果角色无效或内容为空
 */
export function createChatMessage({
    role,
    content,
    turnId,
    id,
    metaOptions = {}
}) {
    if (!VALID_ROLES.has(role)) {
        throw new Error('Chat message role must be "user" or "assistant".');
    }

    const normalizedTurnId = asTrimmedString(turnId) || createTurnId();
    const messageId = asTrimmedString(id) || createMessageId();
    const normalizedContent = role === 'assistant'
        ? stripSourcesSection(typeof content === 'string' ? content : '').trim()
        : asTrimmedString(content);

    if (!normalizedContent) {
        throw new Error('Chat message content cannot be empty.');
    }

    const meta = buildMessageMeta(normalizedContent, {
        ...metaOptions,
        messageId,
        turnId: normalizedTurnId
    });

    return {
        id: messageId,
        turnId: normalizedTurnId,
        role,
        content: normalizedContent,
        meta
    };
}

/**
 * 规范化聊天消息
 *
 * 用于处理从存储或 API 加载的原始消息数据，确保：
 * - 消息结构符合规范
 * - 所有必需字段都存在
 * - 内容已正确规范化
 * - 元数据完整且有效
 *
 * 与 createChatMessage 的区别：
 * - createChatMessage: 创建新消息（严格验证）
 * - normalizeChatMessage: 规范化现有消息（容错处理）
 *
 * @param {Object} rawMessage - 原始消息对象
 * @param {Object} options - 选项
 * @param {string} options.defaultTurnId - 默认轮次 ID
 * @param {number} options.defaultCreatedAt - 默认创建时间
 * @returns {Object|null} 规范化后的消息对象，如果无效则返回 null
 */
export function normalizeChatMessage(rawMessage, {
    defaultTurnId = '',
    defaultCreatedAt = Date.now()
} = {}) {
    const normalizedCore = normalizeMessageCore(rawMessage);
    if (!normalizedCore) {
        return null;
    }

    const normalizedTurnId = asTrimmedString(rawMessage.turnId)
        || asTrimmedString(normalizedCore.rawMeta.turnId)
        || asTrimmedString(defaultTurnId)
        || createTurnId();

    const normalizedMessageId = asTrimmedString(rawMessage.id)
        || asTrimmedString(normalizedCore.rawMeta.messageId)
        || createMessageId();

    const meta = buildMessageMeta(normalizedCore.content, {
        messageId: normalizedMessageId,
        turnId: normalizedTurnId,
        displayContent: normalizedCore.displayContent,
        contextContent: typeof normalizedCore.rawMeta.contextContent === 'string' ? normalizedCore.rawMeta.contextContent : '',
        parts: Array.isArray(normalizedCore.rawMeta.parts) ? normalizedCore.rawMeta.parts : null,
        createdAt: Number.isFinite(normalizedCore.rawMeta.createdAt) ? normalizedCore.rawMeta.createdAt : defaultCreatedAt,
        tokenEstimate: Number.isFinite(normalizedCore.rawMeta.tokenEstimate) ? normalizedCore.rawMeta.tokenEstimate : null,
        displayRole: normalizedCore.rawMeta.displayRole,
        isPrefixMessage: normalizedCore.rawMeta.isPrefixMessage === true,
        prefixType: normalizedCore.rawMeta.prefixType,
        interrupted: normalizedCore.rawMeta.interrupted === true
    });

    return {
        id: normalizedMessageId,
        turnId: normalizedTurnId,
        role: normalizedCore.role,
        content: normalizedCore.content,
        meta
    };
}

/**
 * 克隆单个聊天消息
 * 深拷贝消息对象，包括 parts 数组
 */
export function cloneChatMessage(message) {
    const meta = message.meta ? { ...message.meta } : undefined;
    if (Array.isArray(meta?.parts)) {
        meta.parts = meta.parts.map((part) => JSON.parse(JSON.stringify(part)));
    }

    return {
        id: message.id,
        turnId: message.turnId,
        role: message.role,
        content: message.content,
        meta
    };
}

/**
 * 克隆消息数组
 */
export function cloneChatMessages(messages) {
    return messages.map(cloneChatMessage);
}

/**
 * 获取消息的显示内容
 * 优先使用 displayContent，否则使用 content
 */
export function getMessageDisplayContent(message) {
    if (typeof message?.meta?.displayContent === 'string') {
        return message.meta.displayContent;
    }

    return typeof message?.content === 'string' ? message.content : '';
}

/**
 * 获取消息的上下文内容
 *
 * 用于构建发送给 AI 的上下文，优先级：
 * 1. contextContent（专门用于上下文的内容）
 * 2. content（标准内容）
 * 3. displayContent（显示内容，需移除来源部分）
 */
export function getContextMessageContent(message) {
    if (typeof message?.meta?.contextContent === 'string' && message.meta.contextContent) {
        return message.meta.contextContent;
    }

    if (typeof message?.content === 'string' && message.content) {
        return message.content;
    }

    if (typeof message?.meta?.displayContent === 'string') {
        return stripSourcesSection(message.meta.displayContent);
    }

    return '';
}

/**
 * 根据消息历史构建会话标题
 *
 * 逻辑：
 * - 查找第一条非前缀的用户消息
 * - 提取其内容作为标题
 * - 如果超过 30 个字符，截断并添加省略号
 * - 如果没有合适的消息，返回默认标题
 *
 * @param {Array} messages - 消息数组
 * @returns {string} 会话标题
 */
export function buildSessionTitle(messages) {
    const firstUserMessage = messages.find((message) => (
        message.role === 'user' && message?.meta?.isPrefixMessage !== true
    ));

    if (!firstUserMessage) {
        return DEFAULT_SESSION_TITLE;
    }

    const plainText = asTrimmedString(firstUserMessage.content);
    if (!plainText) {
        return DEFAULT_SESSION_TITLE;
    }

    return plainText.length > 30 ? `${plainText.slice(0, 30)}...` : plainText;
}
