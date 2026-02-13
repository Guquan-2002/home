import { CHAT_SCHEMA_VERSION } from '../constants.js';
import {
    DEFAULT_SESSION_TITLE,
    cloneChatMessages,
    createTurnId,
    normalizeChatMessage
} from '../core/message-model.js';
import { safeGetJson, safeSetJson } from '../../shared/safe-storage.js';

const TURN_PLACEHOLDER = '__pending_turn__';

function createEmptyHistory() {
    return {
        version: CHAT_SCHEMA_VERSION,
        activeSessionId: null,
        sessions: {}
    };
}

function inferSessionTurnIds(messages) {
    let currentTurnId = '';
    const pendingPrefixIndexes = [];

    for (let index = 0; index < messages.length; index += 1) {
        const message = messages[index];
        const hasResolvedTurn = typeof message.turnId === 'string' && message.turnId !== TURN_PLACEHOLDER;

        if (hasResolvedTurn) {
            currentTurnId = message.turnId;

            if (pendingPrefixIndexes.length > 0) {
                for (const pendingIndex of pendingPrefixIndexes.splice(0)) {
                    messages[pendingIndex].turnId = currentTurnId;
                    messages[pendingIndex].meta.turnId = currentTurnId;
                }
            }

            continue;
        }

        if (message.role === 'user') {
            if (message?.meta?.isPrefixMessage === true) {
                pendingPrefixIndexes.push(index);
                continue;
            }

            const userTurnId = createTurnId();
            message.turnId = userTurnId;
            message.meta.turnId = userTurnId;
            currentTurnId = userTurnId;

            if (pendingPrefixIndexes.length > 0) {
                for (const pendingIndex of pendingPrefixIndexes.splice(0)) {
                    messages[pendingIndex].turnId = userTurnId;
                    messages[pendingIndex].meta.turnId = userTurnId;
                }
            }

            continue;
        }

        if (!currentTurnId) {
            currentTurnId = createTurnId();
        }

        message.turnId = currentTurnId;
        message.meta.turnId = currentTurnId;
    }

    if (pendingPrefixIndexes.length > 0) {
        const fallbackTurnId = currentTurnId || createTurnId();
        for (const pendingIndex of pendingPrefixIndexes) {
            messages[pendingIndex].turnId = fallbackTurnId;
            messages[pendingIndex].meta.turnId = fallbackTurnId;
        }
    }
}

function normalizeSessionMessages(rawMessages, baseTimestamp) {
    const normalizedMessages = Array.isArray(rawMessages)
        ? rawMessages
            .map((rawMessage, index) => normalizeChatMessage(rawMessage, {
                defaultTurnId: TURN_PLACEHOLDER,
                defaultCreatedAt: baseTimestamp + index
            }))
            .filter(Boolean)
        : [];

    inferSessionTurnIds(normalizedMessages);

    return normalizedMessages.map((message) => {
        const normalizedTurnId = message.turnId === TURN_PLACEHOLDER
            ? createTurnId()
            : message.turnId;

        return {
            ...message,
            turnId: normalizedTurnId,
            meta: {
                ...message.meta,
                messageId: message.id,
                turnId: normalizedTurnId
            }
        };
    });
}

function normalizeSession(sessionId, rawSession) {
    const timestamp = Number.isFinite(rawSession?.timestamp) && rawSession.timestamp > 0
        ? rawSession.timestamp
        : Date.now();

    const messages = normalizeSessionMessages(rawSession?.messages, timestamp);

    return {
        id: sessionId,
        title: typeof rawSession?.title === 'string' && rawSession.title.trim()
            ? rawSession.title.trim()
            : DEFAULT_SESSION_TITLE,
        messages,
        timestamp
    };
}

function resolveActiveSessionId(activeSessionId, sessions) {
    if (typeof activeSessionId === 'string' && sessions[activeSessionId]) {
        return activeSessionId;
    }

    const sortedSessionIds = Object.values(sessions)
        .sort((sessionA, sessionB) => sessionB.timestamp - sessionA.timestamp)
        .map((session) => session.id);

    return sortedSessionIds[0] || null;
}

function normalizeHistory(rawHistory) {
    if (!rawHistory || typeof rawHistory !== 'object') {
        return createEmptyHistory();
    }

    if (rawHistory.version !== CHAT_SCHEMA_VERSION) {
        return createEmptyHistory();
    }

    if (!rawHistory.sessions || typeof rawHistory.sessions !== 'object') {
        return createEmptyHistory();
    }

    const sessions = Object.fromEntries(
        Object.entries(rawHistory.sessions)
            .map(([sessionId, session]) => [sessionId, normalizeSession(sessionId, session)])
    );

    return {
        version: CHAT_SCHEMA_VERSION,
        activeSessionId: resolveActiveSessionId(rawHistory.activeSessionId, sessions),
        sessions
    };
}

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

export function loadChatHistory(storage, historyKey) {
    const rawHistory = safeGetJson(historyKey, createEmptyHistory(), storage);
    return normalizeHistory(rawHistory);
}

export function saveChatHistory(storage, historyKey, history) {
    const normalizedHistory = normalizeHistory(history);
    return safeSetJson(historyKey, normalizedHistory, storage);
}
