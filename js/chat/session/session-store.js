/**
 * 会话存储管理器
 *
 * 职责：
 * - 管理聊天会话的创建、切换、删除、重命名等操作
 * - 维护会话消息列表（增删改查）
 * - 管理流式响应的生命周期状态（isStreaming、abortController）
 * - 持久化会话数据到 localStorage
 * - 提供会话回滚功能（rollbackToTurn）
 *
 * 依赖：constants.js, message-model.js, history-storage.js
 * 被依赖：api-manager, history-manager, chat.js
 */
import { CHAT_HISTORY_KEY } from '../constants.js';
import {
    DEFAULT_SESSION_TITLE,
    buildSessionTitle,
    cloneChatMessages,
    cloneChatMessage,
    createEntityId
} from '../core/message-model.js';
import { createSessionRecord, loadChatHistory, saveChatHistory } from '../storage/history-storage.js';

/**
 * 将值转换为修剪后的字符串
 */
function asTrimmedString(value) {
    return typeof value === 'string' ? value.trim() : '';
}

/**
 * 按时间戳降序排序会话
 * @returns {Array<[string, Object]>} 排序后的 [sessionId, session] 数组
 */
function sortSessionsByTimestamp(sessions) {
    return Object.entries(sessions)
        .sort(([, sessionA], [, sessionB]) => sessionB.timestamp - sessionA.timestamp);
}

/**
 * 创建会话存储管理器
 *
 * @param {Object} options - 配置选项
 * @param {Storage} options.storage - 存储对象（默认 localStorage）
 * @param {string} options.historyKey - 历史记录存储键
 * @param {Function} options.now - 获取当前时间戳的函数
 * @returns {Object} 会话存储管理器实例
 */
export function createSessionStore({
    storage = null,
    historyKey = CHAT_HISTORY_KEY,
    now = () => Date.now()
} = {}) {
    // 内部状态
    const state = {
        history: loadChatHistory(storage, historyKey),  // 历史记录数据
        isStreaming: false,                              // 是否正在流式响应
        abortController: null,                           // 中止控制器
        abortReason: ''                                  // 中止原因
    };

    /**
     * 持久化历史记录到存储
     */
    function persistHistory() {
        saveChatHistory(storage, historyKey, state.history);
    }

    /**
     * 生成会话 ID
     */
    function generateSessionId() {
        return createEntityId('session');
    }

    /**
     * 获取当前活动会话
     * @returns {Object|null} 会话对象或 null
     */
    function getActiveSession() {
        const activeSessionId = state.history.activeSessionId;
        if (!activeSessionId) {
            return null;
        }

        return state.history.sessions[activeSessionId] || null;
    }

    /**
     * 确保存在活动会话
     *
     * 逻辑：
     * 1. 如果已有活动会话，直接返回其 ID
     * 2. 如果没有活动会话但有其他会话，激活最新的会话
     * 3. 如果没有任何会话，创建新会话并激活
     *
     * @returns {string} 活动会话 ID
     */
    function ensureActiveSession() {
        const activeSession = getActiveSession();
        if (activeSession) {
            return activeSession.id;
        }

        const sortedSessions = sortSessionsByTimestamp(state.history.sessions);
        if (sortedSessions.length > 0) {
            state.history.activeSessionId = sortedSessions[0][0];
            return state.history.activeSessionId;
        }

        const sessionId = generateSessionId();
        state.history.sessions[sessionId] = createSessionRecord(sessionId, {
            title: DEFAULT_SESSION_TITLE,
            messages: [],
            timestamp: now()
        });
        state.history.activeSessionId = sessionId;
        persistHistory();
        return sessionId;
    }

    /**
     * 初始化会话存储
     * 确保有活动会话并持久化
     */
    function initialize() {
        ensureActiveSession();
        persistHistory();
    }

    /**
     * 获取活动会话 ID
     */
    function getActiveSessionId() {
        return ensureActiveSession();
    }

    /**
     * 根据 ID 获取会话
     */
    function getSession(sessionId) {
        return state.history.sessions[sessionId] || null;
    }

    /**
     * 获取活动会话的消息列表
     */
    function getActiveMessages() {
        ensureActiveSession();
        return getActiveSession()?.messages || [];
    }

    /**
     * 获取按时间戳排序的会话列表
     * @returns {Array<{sessionId: string, session: Object}>}
     */
    function getSortedSessions() {
        return sortSessionsByTimestamp(state.history.sessions)
            .map(([sessionId, session]) => ({
                sessionId,
                session
            }));
    }

    /**
     * 更新会话的标题和时间戳
     * 标题根据第一条用户消息自动生成
     */
    function touchSession(session) {
        session.title = buildSessionTitle(session.messages);
        session.timestamp = now();
    }

    /**
     * 向活动会话追加消息
     *
     * @param {Array} messages - 要追加的消息数组
     * @returns {number} 实际追加的消息数量
     */
    function appendMessages(messages) {
        ensureActiveSession();
        const session = getActiveSession();
        if (!session || !Array.isArray(messages) || messages.length === 0) {
            return 0;
        }

        for (const message of messages) {
            session.messages.push(cloneChatMessage(message));
        }

        touchSession(session);
        persistHistory();
        return messages.length;
    }

    /**
     * 替换活动会话的所有消息
     *
     * @param {Array} messages - 新的消息数组
     * @returns {boolean} 是否成功替换
     */
    function replaceActiveMessages(messages) {
        ensureActiveSession();
        const session = getActiveSession();
        if (!session || !Array.isArray(messages)) {
            return false;
        }

        session.messages = cloneChatMessages(messages);
        touchSession(session);
        persistHistory();
        return true;
    }

    /**
     * 回滚到指定轮次
     *
     * 删除从指定 turnId 开始的所有消息，用于重试功能
     *
     * @param {string} turnId - 轮次 ID
     * @returns {Object|null} 回滚结果，包含 startIndex、retryContent、removedMessages
     */
    function rollbackToTurn(turnId) {
        const normalizedTurnId = asTrimmedString(turnId);
        if (!normalizedTurnId) {
            return null;
        }

        ensureActiveSession();
        const session = getActiveSession();
        if (!session) {
            return null;
        }

        const startIndex = session.messages.findIndex((message) => message.turnId === normalizedTurnId);
        if (startIndex === -1) {
            return null;
        }

        const removedMessages = session.messages.splice(startIndex);
        touchSession(session);
        persistHistory();

        // 查找被删除消息中的用户输入，用于重试
        const retrySource = removedMessages.find((message) => (
            message.role === 'user' && message?.meta?.isPrefixMessage !== true
        )) || removedMessages.find((message) => message.role === 'user');

        return {
            startIndex,
            retryContent: retrySource?.content || '',
            removedMessages: cloneChatMessages(removedMessages)
        };
    }

    /**
     * 创建新会话
     *
     * @param {Object} options - 选项
     * @param {string} options.title - 会话标题
     * @returns {string} 新会话 ID
     */
    function createSession({ title = DEFAULT_SESSION_TITLE } = {}) {
        const sessionId = generateSessionId();
        state.history.sessions[sessionId] = createSessionRecord(sessionId, {
            title,
            messages: [],
            timestamp: now()
        });
        state.history.activeSessionId = sessionId;
        persistHistory();
        return sessionId;
    }

    /**
     * 设置活动会话
     *
     * @param {string} sessionId - 会话 ID
     * @returns {boolean} 是否成功设置
     */
    function setActiveSession(sessionId) {
        if (!state.history.sessions[sessionId]) {
            return false;
        }

        state.history.activeSessionId = sessionId;
        persistHistory();
        return true;
    }

    /**
     * 重命名会话
     *
     * @param {string} sessionId - 会话 ID
     * @param {string} nextTitle - 新标题
     * @returns {boolean} 是否成功重命名
     */
    function renameSession(sessionId, nextTitle) {
        const session = getSession(sessionId);
        if (!session) {
            return false;
        }

        const normalizedTitle = asTrimmedString(nextTitle) || DEFAULT_SESSION_TITLE;
        session.title = normalizedTitle;
        session.timestamp = now();
        persistHistory();
        return true;
    }

    /**
     * 删除会话
     *
     * 如果删除的是活动会话，会自动切换到其他会话或创建新会话
     *
     * @param {string} sessionId - 会话 ID
     * @returns {boolean} 是否成功删除
     */
    function deleteSession(sessionId) {
        if (!state.history.sessions[sessionId]) {
            return false;
        }

        delete state.history.sessions[sessionId];

        if (state.history.activeSessionId === sessionId) {
            state.history.activeSessionId = null;
            ensureActiveSession();
        }

        persistHistory();
        return true;
    }

    /**
     * 清空所有会话
     *
     * 删除所有会话后会自动创建一个新的空会话
     *
     * @returns {string} 新创建的会话 ID
     */
    function clearAllSessions() {
        state.history.sessions = {};
        state.history.activeSessionId = null;
        const newSessionId = ensureActiveSession();
        persistHistory();
        return newSessionId;
    }

    /**
     * 检查是否正在流式响应
     */
    function isStreaming() {
        return state.isStreaming;
    }

    /**
     * 开始流式响应
     *
     * @param {AbortController} abortController - 中止控制器
     */
    function startStreaming(abortController) {
        state.isStreaming = true;
        state.abortController = abortController;
        state.abortReason = '';
    }

    /**
     * 结束流式响应
     */
    function finishStreaming() {
        state.isStreaming = false;
        state.abortController = null;
        state.abortReason = '';
    }

    /**
     * 设置中止原因
     */
    function setAbortReason(reason) {
        state.abortReason = asTrimmedString(reason);
    }

    /**
     * 获取中止原因
     */
    function getAbortReason() {
        return state.abortReason;
    }

    /**
     * 获取中止控制器
     */
    function getAbortController() {
        return state.abortController;
    }

    /**
     * 请求中止流式响应
     *
     * @param {string} reason - 中止原因（'user' 或 'connect_timeout'）
     * @returns {boolean} 是否成功请求中止
     */
    function requestAbort(reason = 'user') {
        if (!state.abortController) {
            return false;
        }

        state.abortReason = asTrimmedString(reason) || 'user';
        state.abortController.abort();
        return true;
    }

    return {
        initialize,
        getSession,
        getSortedSessions,
        getActiveSession,
        getActiveSessionId,
        getActiveMessages,
        appendMessages,
        replaceActiveMessages,
        rollbackToTurn,
        createSession,
        setActiveSession,
        renameSession,
        deleteSession,
        clearAllSessions,
        isStreaming,
        startStreaming,
        finishStreaming,
        setAbortReason,
        getAbortReason,
        getAbortController,
        requestAbort
    };
}
