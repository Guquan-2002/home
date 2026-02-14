/**
 * 会话历史管理器
 *
 * 职责：
 * - 绑定会话列表 UI 操作到 store 操作
 * - 渲染会话历史列表（包括标题、激活状态、编辑/删除按钮）
 * - 处理会话切换、创建、删除、重命名等用户交互
 * - 管理会话操作的权限检查（如流式响应时禁止操作）
 *
 * 依赖：session-store.js
 * 被依赖：chat.js
 */

/**
 * 创建会话历史管理器
 *
 * @param {Object} params - 参数
 * @param {Object} params.store - 会话存储实例
 * @param {Object} params.elements - DOM 元素集合
 * @param {HTMLElement} params.elements.historyDiv - 历史记录容器
 * @param {HTMLElement} params.elements.historyList - 历史记录列表
 * @param {Function} params.onSessionActivated - 会话激活回调
 * @param {Function} params.onSessionDeleted - 会话删除回调
 * @param {Function} params.onSessionsCleared - 清空会话回调
 * @param {Function} params.isSessionOperationBlocked - 检查操作是否被阻止
 * @param {Function} params.onBlockedSessionOperation - 操作被阻止时的回调
 * @returns {Object} 历史管理器实例
 */
export function createHistoryManager({
    store,
    elements,
    onSessionActivated,
    onSessionDeleted = null,
    onSessionsCleared = null,
    isSessionOperationBlocked = null,
    onBlockedSessionOperation = null
}) {
    const { historyDiv, historyList } = elements;

    // 规范化回调函数
    const isOperationBlocked = typeof isSessionOperationBlocked === 'function'
        ? isSessionOperationBlocked
        : () => false;
    const notifyBlockedOperation = typeof onBlockedSessionOperation === 'function'
        ? onBlockedSessionOperation
        : () => {};

    /**
     * 确保会话操作被允许
     * 如果操作被阻止（如正在流式响应），通知用户并返回 false
     */
    function ensureSessionOperationAllowed() {
        if (!isOperationBlocked()) {
            return true;
        }

        notifyBlockedOperation();
        return false;
    }

    /**
     * 激活指定会话
     */
    function activateSession(sessionId) {
        const loaded = store.setActiveSession(sessionId);
        if (!loaded) {
            return false;
        }

        onSessionActivated?.();
        return true;
    }

    /**
     * 创建新会话
     *
     * @param {Object} options - 选项
     * @param {boolean} options.skipBusyCheck - 是否跳过忙碌检查
     * @returns {string|null} 新会话 ID 或 null
     */
    function createNewSession({ skipBusyCheck = false } = {}) {
        if (!skipBusyCheck && !ensureSessionOperationAllowed()) {
            return null;
        }

        const sessionId = store.createSession();
        onSessionActivated?.();
        return sessionId;
    }

    /**
     * 加载指定会话
     */
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

    /**
     * 删除指定会话
     */
    function deleteSession(sessionId) {
        if (!ensureSessionOperationAllowed()) {
            return;
        }

        const deleted = store.deleteSession(sessionId);
        if (!deleted) {
            return;
        }

        if (typeof onSessionDeleted === 'function') {
            onSessionDeleted(sessionId);
        }

        onSessionActivated?.();
        renderHistoryList();
    }

    /**
     * 清空所有会话
     * 会弹出确认对话框
     */
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

        const deletedSessionIds = sortedSessions.map(({ sessionId }) => sessionId);
        store.clearAllSessions();

        if (typeof onSessionsCleared === 'function') {
            onSessionsCleared(deletedSessionIds);
        }

        onSessionActivated?.();
        renderHistoryList();
    }

    /**
     * 编辑会话标题
     */
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

    /**
     * 渲染会话历史列表
     *
     * 为每个会话创建 DOM 元素，包括：
     * - 会话标题（可点击切换）
     * - 编辑按钮（点击后显示输入框）
     * - 删除按钮（点击后弹出确认对话框）
     * - 激活状态标记（active 类名）
     */
    function renderHistoryList() {
        historyList.innerHTML = '';

        const sortedSessions = store.getSortedSessions();
        const activeSessionId = store.getActiveSessionId();

        sortedSessions.forEach(({ sessionId, session }) => {
            // 创建会话项容器
            const item = document.createElement('div');
            item.className = 'history-item';
            if (sessionId === activeSessionId) {
                item.classList.add('active');
            }

            // 创建标题元素（可点击切换会话）
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

            // 创建操作按钮容器
            const actions = document.createElement('div');
            actions.className = 'history-item-actions';

            // 创建编辑按钮
            const editButton = document.createElement('button');
            editButton.className = 'history-item-edit';
            editButton.innerHTML = '<i class="fas fa-edit"></i>';
            editButton.title = 'Rename';
            editButton.addEventListener('click', (event) => {
                event.stopPropagation();

                // 将标题替换为输入框
                const input = document.createElement('input');
                input.type = 'text';
                input.className = 'history-item-title-input';
                input.value = session.title;

                item.replaceChild(input, title);
                actions.style.display = 'none';
                input.focus();
                input.select();

                // 保存编辑
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

            // 创建删除按钮
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
