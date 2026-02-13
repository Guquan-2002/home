import { CHAT_HISTORY_KEY } from '../constants.js';
import {
    DEFAULT_SESSION_TITLE,
    buildSessionTitle,
    cloneChatMessages,
    cloneChatMessage,
    createEntityId
} from '../core/message-model.js';
import { createSessionRecord, loadChatHistory, saveChatHistory } from '../storage/history-storage.js';

function asTrimmedString(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function sortSessionsByTimestamp(sessions) {
    return Object.entries(sessions)
        .sort(([, sessionA], [, sessionB]) => sessionB.timestamp - sessionA.timestamp);
}

export function createSessionStore({
    storage = null,
    historyKey = CHAT_HISTORY_KEY,
    now = () => Date.now()
} = {}) {
    const state = {
        history: loadChatHistory(storage, historyKey),
        isStreaming: false,
        abortController: null,
        abortReason: ''
    };

    function persistHistory() {
        saveChatHistory(storage, historyKey, state.history);
    }

    function generateSessionId() {
        return createEntityId('session');
    }

    function getActiveSession() {
        const activeSessionId = state.history.activeSessionId;
        if (!activeSessionId) {
            return null;
        }

        return state.history.sessions[activeSessionId] || null;
    }

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

    function initialize() {
        ensureActiveSession();
        persistHistory();
    }

    function getActiveSessionId() {
        return ensureActiveSession();
    }

    function getSession(sessionId) {
        return state.history.sessions[sessionId] || null;
    }

    function getActiveMessages() {
        ensureActiveSession();
        return getActiveSession()?.messages || [];
    }

    function getSortedSessions() {
        return sortSessionsByTimestamp(state.history.sessions)
            .map(([sessionId, session]) => ({
                sessionId,
                session
            }));
    }

    function touchSession(session) {
        session.title = buildSessionTitle(session.messages);
        session.timestamp = now();
    }

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

        const retrySource = removedMessages.find((message) => (
            message.role === 'user' && message?.meta?.isPrefixMessage !== true
        )) || removedMessages.find((message) => message.role === 'user');

        return {
            startIndex,
            retryContent: retrySource?.content || '',
            removedMessages: cloneChatMessages(removedMessages)
        };
    }

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

    function setActiveSession(sessionId) {
        if (!state.history.sessions[sessionId]) {
            return false;
        }

        state.history.activeSessionId = sessionId;
        persistHistory();
        return true;
    }

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

    function clearAllSessions() {
        state.history.sessions = {};
        state.history.activeSessionId = null;
        const newSessionId = ensureActiveSession();
        persistHistory();
        return newSessionId;
    }

    function isStreaming() {
        return state.isStreaming;
    }

    function startStreaming(abortController) {
        state.isStreaming = true;
        state.abortController = abortController;
        state.abortReason = '';
    }

    function finishStreaming() {
        state.isStreaming = false;
        state.abortController = null;
        state.abortReason = '';
    }

    function setAbortReason(reason) {
        state.abortReason = asTrimmedString(reason);
    }

    function getAbortReason() {
        return state.abortReason;
    }

    function getAbortController() {
        return state.abortController;
    }

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
