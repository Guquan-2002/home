import { SOURCES_MARKDOWN_MARKER } from './constants.js';

const DEFAULT_SESSION_TITLE = 'New chat';

function buildSessionTitle(messages) {
    const firstUserMessage = messages.find((message) => (
        message.role === 'user' && !message?.meta?.isPrefixMessage
    ));
    if (!firstUserMessage) return DEFAULT_SESSION_TITLE;

    const plainText = (firstUserMessage.content || '').trim();
    if (!plainText) return DEFAULT_SESSION_TITLE;

    return plainText.length > 30 ? `${plainText.slice(0, 30)}...` : plainText;
}

function stripSourcesSection(text) {
    if (typeof text !== 'string') return '';

    const sourcesIndex = text.lastIndexOf(SOURCES_MARKDOWN_MARKER);
    if (sourcesIndex === -1) {
        return text;
    }

    return text.slice(0, sourcesIndex).trimEnd();
}

function normalizeMessage(rawMessage) {
    if (!rawMessage || (rawMessage.role !== 'user' && rawMessage.role !== 'assistant')) {
        return null;
    }

    const role = rawMessage.role;
    const rawContent = typeof rawMessage.content === 'string' ? rawMessage.content : '';
    const rawMeta = rawMessage.meta && typeof rawMessage.meta === 'object' ? rawMessage.meta : {};
    const rawDisplayContent = typeof rawMeta.displayContent === 'string' ? rawMeta.displayContent : '';

    const normalized = {
        role,
        content: role === 'assistant'
            ? stripSourcesSection(rawContent || rawDisplayContent).trim()
            : (rawContent || rawDisplayContent).trim()
    };

    if (!normalized.content.trim()) {
        return null;
    }

    const normalizedMeta = {};

    const displayContent = role === 'assistant'
        ? stripSourcesSection(rawDisplayContent || rawContent)
        : (rawDisplayContent || rawContent);
    if (displayContent && displayContent !== normalized.content) {
        normalizedMeta.displayContent = displayContent;
    }

    if (Number.isFinite(rawMeta.tokenEstimate) && rawMeta.tokenEstimate > 0) {
        normalizedMeta.tokenEstimate = rawMeta.tokenEstimate;
    }

    if (Number.isFinite(rawMeta.createdAt) && rawMeta.createdAt > 0) {
        normalizedMeta.createdAt = rawMeta.createdAt;
    }

    if (typeof rawMeta.contextContent === 'string' && rawMeta.contextContent.trim()) {
        normalizedMeta.contextContent = rawMeta.contextContent.trim();
    }

    if (rawMeta.displayRole === 'system' || rawMeta.displayRole === 'assistant' || rawMeta.displayRole === 'user') {
        normalizedMeta.displayRole = rawMeta.displayRole;
    }

    if (rawMeta.isPrefixMessage === true) {
        normalizedMeta.isPrefixMessage = true;
    }

    if (typeof rawMeta.prefixType === 'string' && rawMeta.prefixType) {
        normalizedMeta.prefixType = rawMeta.prefixType;
    }

    if (typeof rawMeta.messageId === 'string' && rawMeta.messageId.trim()) {
        normalizedMeta.messageId = rawMeta.messageId.trim();
    }

    if (Object.keys(normalizedMeta).length > 0) {
        normalized.meta = normalizedMeta;
    }

    return normalized;
}

function getMessageDisplayContent(message) {
    if (typeof message?.meta?.displayContent === 'string') {
        return message.meta.displayContent;
    }

    return message.content;
}

function normalizeSession(session) {
    if (!session || typeof session !== 'object') {
        return {
            title: DEFAULT_SESSION_TITLE,
            messages: [],
            timestamp: Date.now()
        };
    }

    const messages = Array.isArray(session.messages)
        ? session.messages.map(normalizeMessage).filter(Boolean)
        : [];

    return {
        title: typeof session.title === 'string' && session.title.trim()
            ? session.title.trim()
            : DEFAULT_SESSION_TITLE,
        messages,
        timestamp: Number.isFinite(session.timestamp) && session.timestamp > 0
            ? session.timestamp
            : Date.now()
    };
}

function cloneMessage(message) {
    if (!message.meta) {
        return { role: message.role, content: message.content };
    }

    return {
        role: message.role,
        content: message.content,
        meta: { ...message.meta }
    };
}

function cloneMessages(messages) {
    return messages.map(cloneMessage);
}

function createSessionId() {
    if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
        return `session_${globalThis.crypto.randomUUID()}`;
    }

    return `session_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function createHistoryManager({
    state,
    elements,
    addMessage,
    historyKey,
    isSessionOperationBlocked = null,
    onBlockedSessionOperation = null
}) {
    const { messagesEl, historyDiv, historyList } = elements;
    const isOperationBlocked = typeof isSessionOperationBlocked === 'function'
        ? isSessionOperationBlocked
        : () => false;
    const notifyBlockedOperation = typeof onBlockedSessionOperation === 'function'
        ? onBlockedSessionOperation
        : () => {};

    function ensureSessionOperationAllowed() {
        if (!isOperationBlocked()) {
            return true;
        }

        notifyBlockedOperation();
        return false;
    }

    function loadChatHistory() {
        try {
            const rawHistory = localStorage.getItem(historyKey);
            if (!rawHistory) {
                state.chatSessions = {};
                return;
            }

            const parsed = JSON.parse(rawHistory);
            if (!parsed || typeof parsed !== 'object') {
                state.chatSessions = {};
                return;
            }

            state.chatSessions = Object.fromEntries(
                Object.entries(parsed).map(([sessionId, session]) => [sessionId, normalizeSession(session)])
            );
        } catch {
            state.chatSessions = {};
        }
    }

    function saveChatHistory() {
        try {
            localStorage.setItem(historyKey, JSON.stringify(state.chatSessions));
        } catch {
            // Ignore storage failures.
        }
    }

    function createNewSession({ skipBusyCheck = false } = {}) {
        if (!skipBusyCheck && !ensureSessionOperationAllowed()) {
            return null;
        }

        const sessionId = createSessionId();
        state.currentSessionId = sessionId;
        state.conversationHistory = [];

        state.chatSessions[sessionId] = {
            title: DEFAULT_SESSION_TITLE,
            messages: [],
            timestamp: Date.now()
        };

        saveChatHistory();
        messagesEl.innerHTML = '';
        return sessionId;
    }

    function saveCurrentSession() {
        if (!state.currentSessionId) return;

        const normalizedMessages = state.conversationHistory
            .map(normalizeMessage)
            .filter(Boolean);

        state.chatSessions[state.currentSessionId] = {
            title: buildSessionTitle(normalizedMessages),
            messages: cloneMessages(normalizedMessages),
            timestamp: Date.now()
        };

        saveChatHistory();
    }

    function loadSession(sessionId) {
        if (!ensureSessionOperationAllowed()) return false;

        const session = state.chatSessions[sessionId];
        if (!session) return false;

        const normalizedSession = normalizeSession(session);
        state.chatSessions[sessionId] = normalizedSession;

        state.currentSessionId = sessionId;
        state.conversationHistory = cloneMessages(normalizedSession.messages);

        messagesEl.innerHTML = '';
        state.conversationHistory.forEach((message) => {
            addMessage(message.role, getMessageDisplayContent(message), message.meta);
        });

        return true;
    }

    function deleteSession(sessionId) {
        if (!ensureSessionOperationAllowed()) return;

        delete state.chatSessions[sessionId];
        saveChatHistory();

        if (state.currentSessionId === sessionId) {
            createNewSession({ skipBusyCheck: true });
        }

        renderHistoryList();
    }

    function clearAllSessions() {
        if (!ensureSessionOperationAllowed()) return;
        if (Object.keys(state.chatSessions).length === 0) return;

        const confirmed = confirm('Delete all chat sessions? This action cannot be undone.');
        if (!confirmed) return;

        state.chatSessions = {};
        saveChatHistory();
        createNewSession();
        renderHistoryList();
    }

    function editSessionTitle(sessionId, nextTitle) {
        if (!ensureSessionOperationAllowed()) return;

        const session = state.chatSessions[sessionId];
        if (!session) return;

        session.title = nextTitle.trim() || DEFAULT_SESSION_TITLE;
        session.timestamp = Date.now();
        saveChatHistory();
        renderHistoryList();
    }

    function renderHistoryList() {
        historyList.innerHTML = '';

        const sortedSessions = Object.entries(state.chatSessions)
            .sort(([, sessionA], [, sessionB]) => sessionB.timestamp - sessionA.timestamp);

        sortedSessions.forEach(([sessionId, session]) => {
            const item = document.createElement('div');
            item.className = 'history-item';
            if (sessionId === state.currentSessionId) {
                item.classList.add('active');
            }

            const title = document.createElement('span');
            title.className = 'history-item-title';
            title.textContent = session.title;
            title.addEventListener('click', () => {
                const loaded = loadSession(sessionId);
                if (!loaded) return;
                historyDiv.classList.add('chat-history-hidden');
                renderHistoryList();
            });

            const actions = document.createElement('div');
            actions.className = 'history-item-actions';

            const editButton = document.createElement('button');
            editButton.className = 'history-item-edit';
            editButton.innerHTML = '<i class="fas fa-edit"></i>';
            editButton.title = 'Rename';
            editButton.addEventListener('click', (event) => {
                event.stopPropagation();

                const input = document.createElement('input');
                input.type = 'text';
                input.className = 'history-item-title-input';
                input.value = session.title;

                item.replaceChild(input, title);
                actions.style.display = 'none';
                input.focus();
                input.select();

                const saveEdit = () => {
                    const trimmedTitle = input.value.trim();
                    if (trimmedTitle && trimmedTitle !== session.title) {
                        editSessionTitle(sessionId, trimmedTitle);
                    } else {
                        renderHistoryList();
                    }
                };

                input.addEventListener('blur', saveEdit);
                input.addEventListener('keydown', (keyEvent) => {
                    if (keyEvent.key === 'Enter') {
                        saveEdit();
                    } else if (keyEvent.key === 'Escape') {
                        renderHistoryList();
                    }
                });
            });

            const deleteButton = document.createElement('button');
            deleteButton.className = 'history-item-delete';
            deleteButton.innerHTML = '<i class="fas fa-trash"></i>';
            deleteButton.title = 'Delete';
            deleteButton.addEventListener('click', (event) => {
                event.stopPropagation();
                const confirmed = confirm('Delete this chat session?');
                if (confirmed) {
                    deleteSession(sessionId);
                }
            });

            actions.append(editButton, deleteButton);
            item.append(title, actions);
            historyList.appendChild(item);
        });
    }

    return {
        loadChatHistory,
        saveChatHistory,
        createNewSession,
        saveCurrentSession,
        loadSession,
        clearAllSessions,
        renderHistoryList
    };
}
