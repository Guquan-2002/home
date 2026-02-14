/**
 * 聊天历史存储管理
 *
 * 职责：
 * - 负责聊天历史记录的持久化存储和加载
 * - 将持久化的历史数据规范化为最新的 schema 版本
 * - 严格校验消息 turnId 的合法性，不再修复旧数据
 * - 管理多个会话（session）及其消息历史
 * - 处理活动会话的选择和切换
 *
 * 依赖：
 * - constants.js（schema 版本号）
 * - message-model.js（消息规范化、ID 生成）
 * - safe-storage.js（安全的 JSON 存储操作）
 *
 * 被依赖：session-store, api-manager
 */
import { CHAT_SCHEMA_VERSION } from '../constants.js';
import {
    DEFAULT_SESSION_TITLE,
    cloneChatMessages,
    normalizeChatMessage
} from '../core/message-model.js';
import { safeGetJson, safeSetJson } from '../../shared/safe-storage.js';

/**
 * 创建空的历史记录对象
 * @returns {Object} 空历史记录结构
 */
function createEmptyHistory() {
    return {
        version: CHAT_SCHEMA_VERSION,
        activeSessionId: null,
        sessions: {}
    };
}

/**
 * 校验原始历史消息的 turnId 合法性
 * 要求 message.turnId 与 message.meta.turnId 都为非空字符串且完全一致。
 *
 * @param {Object} rawMessage - 原始消息对象
 * @returns {boolean} 是否合法
 */
function isValidRawHistoryTurnId(rawMessage) {
    const turnId = typeof rawMessage?.turnId === 'string' ? rawMessage.turnId.trim() : '';
    const metaTurnId = typeof rawMessage?.meta?.turnId === 'string' ? rawMessage.meta.turnId.trim() : '';
    return Boolean(turnId) && Boolean(metaTurnId) && turnId === metaTurnId;
}

/**
 * 校验规范化后消息的 turnId 合法性
 *
 * @param {Object} message - 规范化后的消息对象
 * @returns {boolean} 是否合法
 */
function isValidNormalizedMessageForHistory(message) {
    const turnId = typeof message?.turnId === 'string' ? message.turnId.trim() : '';
    const metaTurnId = typeof message?.meta?.turnId === 'string' ? message.meta.turnId.trim() : '';
    return Boolean(turnId) && Boolean(metaTurnId) && turnId === metaTurnId;
}

/**
 * 规范化会话消息数组
 *
 * @param {Array} rawMessages - 原始消息数组
 * @param {number} baseTimestamp - 基准时间戳（用于为缺失时间戳的消息生成递增时间）
 * @returns {{ messages: Array, isValid: boolean }} 规范化结果
 */
function normalizeSessionMessages(rawMessages, baseTimestamp) {
    if (!Array.isArray(rawMessages)) {
        return { messages: [], isValid: false };
    }

    const normalizedMessages = [];
    for (let index = 0; index < rawMessages.length; index += 1) {
        const rawMessage = rawMessages[index];
        if (!isValidRawHistoryTurnId(rawMessage)) {
            return { messages: [], isValid: false };
        }

        const message = normalizeChatMessage(rawMessage, {
            defaultCreatedAt: baseTimestamp + index
        });

        if (!message || !isValidNormalizedMessageForHistory(message)) {
            return { messages: [], isValid: false };
        }

        normalizedMessages.push({
            ...message,
            meta: {
                ...message.meta,
                messageId: message.id,
                turnId: message.turnId
            }
        });
    }

    return { messages: normalizedMessages, isValid: true };
}

/**
 * 规范化单个会话对象
 *
 * @param {string} sessionId - 会话 ID
 * @param {Object} rawSession - 原始会话数据
 * @returns {Object} 规范化后的会话对象
 */
function normalizeSession(sessionId, rawSession) {
    if (!rawSession || typeof rawSession !== 'object') {
        return null;
    }

    const timestamp = Number.isFinite(rawSession?.timestamp) && rawSession.timestamp > 0
        ? rawSession.timestamp
        : Date.now();

    const normalizedMessages = normalizeSessionMessages(rawSession?.messages, timestamp);
    if (!normalizedMessages.isValid) {
        return null;
    }

    return {
        id: sessionId,
        title: typeof rawSession?.title === 'string' && rawSession.title.trim()
            ? rawSession.title.trim()
            : DEFAULT_SESSION_TITLE,
        messages: normalizedMessages.messages,
        timestamp
    };
}

/**
 * 解析活动会话 ID
 *
 * 如果指定的活动会话 ID 无效，则选择最新的会话作为活动会话
 *
 * @param {string} activeSessionId - 指定的活动会话 ID
 * @param {Object} sessions - 所有会话对象
 * @returns {string|null} 有效的活动会话 ID，如果没有会话则返回 null
 */
function resolveActiveSessionId(activeSessionId, sessions) {
    if (typeof activeSessionId === 'string' && sessions[activeSessionId]) {
        return activeSessionId;
    }

    // 按时间戳降序排序，选择最新的会话
    const sortedSessionIds = Object.values(sessions)
        .sort((sessionA, sessionB) => sessionB.timestamp - sessionA.timestamp)
        .map((session) => session.id);

    return sortedSessionIds[0] || null;
}

/**
 * 规范化历史记录对象
 *
 * 验证 schema 版本，规范化所有会话和消息，确保数据结构的一致性
 *
 * @param {Object} rawHistory - 原始历史记录数据
 * @returns {Object} 规范化后的历史记录对象
 */
function normalizeHistory(rawHistory) {
    if (!rawHistory || typeof rawHistory !== 'object') {
        return createEmptyHistory();
    }

    // 版本不匹配，返回空历史（不兼容旧版本）
    if (rawHistory.version !== CHAT_SCHEMA_VERSION) {
        return createEmptyHistory();
    }

    if (!rawHistory.sessions || typeof rawHistory.sessions !== 'object') {
        return createEmptyHistory();
    }

    // 任一会话出现非法消息，整份历史直接重置为空
    const sessions = {};
    for (const [sessionId, session] of Object.entries(rawHistory.sessions)) {
        const normalizedSession = normalizeSession(sessionId, session);
        if (!normalizedSession) {
            return createEmptyHistory();
        }
        sessions[sessionId] = normalizedSession;
    }

    return {
        version: CHAT_SCHEMA_VERSION,
        activeSessionId: resolveActiveSessionId(rawHistory.activeSessionId, sessions),
        sessions
    };
}

/**
 * 创建会话记录对象
 *
 * 用于创建新的会话或克隆现有会话
 *
 * @param {string} sessionId - 会话 ID
 * @param {Object} options - 会话选项
 * @param {string} options.title - 会话标题
 * @param {Array} options.messages - 消息数组
 * @param {number} options.timestamp - 创建时间戳
 * @returns {Object} 会话记录对象
 */
export function createSessionRecord(sessionId, {
    title = DEFAULT_SESSION_TITLE,
    messages = [],
    timestamp = Date.now()
} = {}) {
    return {
        id: sessionId,
        title: typeof title === 'string' && title.trim() ? title.trim() : DEFAULT_SESSION_TITLE,
        messages: cloneChatMessages(messages),
        timestamp: Number.isFinite(timestamp) && timestamp > 0 ? timestamp : Date.now()
    };
}

/**
 * 从存储加载聊天历史
 *
 * @param {Storage} storage - 存储对象（localStorage 或 sessionStorage）
 * @param {string} historyKey - 存储键名
 * @returns {Object} 规范化后的历史记录对象
 */
export function loadChatHistory(storage, historyKey) {
    const rawHistory = safeGetJson(historyKey, createEmptyHistory(), storage);
    return normalizeHistory(rawHistory);
}

/**
 * 保存聊天历史到存储
 *
 * @param {Storage} storage - 存储对象（localStorage 或 sessionStorage）
 * @param {string} historyKey - 存储键名
 * @param {Object} history - 历史记录对象
 * @returns {boolean} 是否保存成功
 */
export function saveChatHistory(storage, historyKey, history) {
    const normalizedHistory = normalizeHistory(history);
    return safeSetJson(historyKey, normalizedHistory, storage);
}

