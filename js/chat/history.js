export function createHistoryManager({
    store,
    elements,
    onSessionActivated,
    isSessionOperationBlocked = null,
    onBlockedSessionOperation = null
}) {
    const { historyDiv, historyList } = elements;

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

    function activateSession(sessionId) {
        const loaded = store.setActiveSession(sessionId);
        if (!loaded) {
            return false;
        }

        onSessionActivated?.();
        return true;
    }

    function createNewSession({ skipBusyCheck = false } = {}) {
        if (!skipBusyCheck && !ensureSessionOperationAllowed()) {
            return null;
        }

        const sessionId = store.createSession();
        onSessionActivated?.();
        return sessionId;
    }

    function loadSession(sessionId) {
        if (!ensureSessionOperationAllowed()) {
            return false;
        }

        const loaded = activateSession(sessionId);
        if (!loaded) {
            return false;
        }

        return true;
    }

    function deleteSession(sessionId) {
        if (!ensureSessionOperationAllowed()) {
            return;
        }

        const deleted = store.deleteSession(sessionId);
        if (!deleted) {
            return;
        }

        onSessionActivated?.();
        renderHistoryList();
    }

    function clearAllSessions() {
        if (!ensureSessionOperationAllowed()) {
            return;
        }

        const sortedSessions = store.getSortedSessions();
        if (sortedSessions.length === 0) {
            return;
        }

        const confirmed = confirm('Delete all chat sessions? This action cannot be undone.');
        if (!confirmed) {
            return;
        }

        store.clearAllSessions();
        onSessionActivated?.();
        renderHistoryList();
    }

    function editSessionTitle(sessionId, nextTitle) {
        if (!ensureSessionOperationAllowed()) {
            return;
        }

        const renamed = store.renameSession(sessionId, nextTitle);
        if (!renamed) {
            return;
        }

        renderHistoryList();
    }

    function renderHistoryList() {
        historyList.innerHTML = '';

        const sortedSessions = store.getSortedSessions();
        const activeSessionId = store.getActiveSessionId();

        sortedSessions.forEach(({ sessionId, session }) => {
            const item = document.createElement('div');
            item.className = 'history-item';
            if (sessionId === activeSessionId) {
                item.classList.add('active');
            }

            const title = document.createElement('span');
            title.className = 'history-item-title';
            title.textContent = session.title;
            title.addEventListener('click', () => {
                const loaded = loadSession(sessionId);
                if (!loaded) {
                    return;
                }

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
        createNewSession,
        loadSession,
        clearAllSessions,
        renderHistoryList
    };
}
