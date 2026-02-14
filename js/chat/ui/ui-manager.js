/**
 * 聊天 UI 管理器
 *
 * 职责：
 * - 渲染聊天消息（用户消息、助手消息、错误消息、系统通知）
 * - 管理流式响应的 UI 状态（加载动画、流式更新、完成渲染）
 * - 控制输入框和按钮的启用/禁用状态
 * - 处理代码块复制、图片附件显示、重试按钮等交互
 * - 管理消息列表的滚动和数量限制
 *
 * 依赖：markdown.js（Markdown 渲染）
 * 被依赖：api-manager, chat.js
 */

/**
 * 创建 UI 管理器
 *
 * @param {Object} params - 参数
 * @param {Object} params.elements - DOM 元素集合
 * @param {Function} params.renderMarkdown - Markdown 渲染函数
 * @param {number} params.maxRenderedMessages - 最大渲染消息数
 * @param {Function} params.onRetryRequested - 重试请求回调
 * @param {Function} params.isRetryBlocked - 检查重试是否被阻止
 * @returns {Object} UI 管理器实例
 */
export function createUiManager({
    elements,
    renderMarkdown,
    maxRenderedMessages,
    onRetryRequested = null,
    isRetryBlocked = null
}) {
    const {
        messagesEl,
        chatInput,
        attachBtn = null,
        sendBtn,
        stopBtn,
        sessionActionButtons = []
    } = elements;

    // 规范化回调函数
    const handleRetryRequested = typeof onRetryRequested === 'function'
        ? onRetryRequested
        : () => {};
    const retryBlocked = typeof isRetryBlocked === 'function'
        ? isRetryBlocked
        : () => false;

    /**
     * 滚动到消息列表底部
     */
    function scrollToBottom(smooth = true) {
        messagesEl.scrollTo({
            top: messagesEl.scrollHeight,
            behavior: smooth ? 'smooth' : 'auto'
        });
    }

    /**
     * 为代码块添加复制按钮
     *
     * 遍历容器中的所有 <pre> 元素，为每个代码块添加复制按钮
     * 点击按钮后复制代码到剪贴板，并显示成功反馈
     */
    function addCopyButtons(container) {
        container.querySelectorAll('pre').forEach((pre) => {
            if (pre.querySelector('.code-copy-btn')) return;

            const button = document.createElement('button');
            button.className = 'code-copy-btn';
            button.innerHTML = '<i class="fas fa-copy"></i>';
            button.title = 'Copy code';

            button.addEventListener('click', () => {
                const code = pre.querySelector('code')?.textContent || pre.textContent || '';
                navigator.clipboard.writeText(code)
                    .then(() => {
                        button.innerHTML = '<i class="fas fa-check"></i>';
                        setTimeout(() => {
                            button.innerHTML = '<i class="fas fa-copy"></i>';
                        }, 1500);
                    })
                    .catch(() => {
                        // 忽略剪贴板失败
                    });
            });

            pre.appendChild(button);
        });
    }

    /**
     * 修剪旧消息
     * 当消息数量超过限制时，删除最早的消息
     */
    function pruneOldMessages() {
        while (messagesEl.children.length > maxRenderedMessages) {
            messagesEl.removeChild(messagesEl.firstChild);
        }
    }

    /**
     * 清空所有消息
     */
    function clearMessages() {
        messagesEl.innerHTML = '';
    }

    /**
     * 构建消息 DOM 元素
     *
     * @param {string} role - 消息角色（'user' 或 'assistant'）
     * @param {string} displayRole - 显示角色（用于特殊消息类型）
     * @param {Object} identifiers - 标识符（messageId、turnId）
     * @returns {HTMLElement} 消息元素
     */
    function buildMessageElement(role, displayRole, identifiers = {}) {
        const messageElement = document.createElement('div');
        messageElement.className = `chat-msg ${displayRole || role}`;

        const messageId = typeof identifiers?.messageId === 'string' ? identifiers.messageId : '';
        const turnId = typeof identifiers?.turnId === 'string' ? identifiers.turnId : '';

        if (messageId) {
            messageElement.dataset.messageId = messageId;
        }

        if (turnId) {
            messageElement.dataset.turnId = turnId;
        }

        return messageElement;
    }

    /**
     * 追加消息元素到列表
     */
    function appendMessageElement(messageElement) {
        messagesEl.appendChild(messageElement);
        pruneOldMessages();
        scrollToBottom(false);
        return messageElement;
    }

    /**
     * 追加用户消息的图片附件
     *
     * 从消息元数据中提取图片部分，渲染为图片列表
     */
    function appendUserImageParts(messageElement, meta) {
        const parts = Array.isArray(meta?.parts) ? meta.parts : [];
        const imageParts = parts.filter((part) => part?.type === 'image' && typeof part?.image?.value === 'string');
        if (imageParts.length === 0) {
            return;
        }

        const imageList = document.createElement('div');
        imageList.className = 'chat-user-images';

        imageParts.forEach((part, index) => {
            const image = document.createElement('img');
            image.className = 'chat-user-image';
            image.src = part.image.value;
            image.alt = `uploaded-image-${index + 1}`;
            image.loading = 'lazy';
            imageList.appendChild(image);
        });

        messageElement.appendChild(imageList);
    }

    /**
     * 添加消息到 UI
     *
     * @param {string} role - 消息角色
     * @param {string} text - 消息文本
     * @param {Object} meta - 消息元数据
     * @param {Object} identifiers - 标识符
     * @returns {HTMLElement} 消息元素
     */
    function addMessage(role, text, meta = null, identifiers = {}) {
        const displayRole = typeof meta?.displayRole === 'string' ? meta.displayRole : role;
        const shouldShowRetry = role === 'user' && displayRole === 'user' && !meta?.isPrefixMessage;
        const messageElement = buildMessageElement(role, displayRole, identifiers);

        // 助手消息使用 Markdown 渲染
        if (displayRole === 'assistant' && text) {
            messageElement.innerHTML = renderMarkdown(text);
            addCopyButtons(messageElement);
        } else {
            messageElement.textContent = text;
        }

        // 用户消息显示图片附件
        if (role === 'user' && displayRole === 'user') {
            appendUserImageParts(messageElement, meta);
        }

        // 为用户消息添加重试按钮
        if (shouldShowRetry && identifiers?.turnId) {
            const retryButton = document.createElement('button');
            retryButton.className = 'msg-retry-btn';
            retryButton.innerHTML = '<i class="fas fa-redo"></i>';
            retryButton.title = 'Retry from this message';

            retryButton.addEventListener('click', () => {
                if (retryBlocked()) {
                    return;
                }

                handleRetryRequested({
                    turnId: identifiers.turnId,
                    messageId: identifiers.messageId,
                    content: text
                });
            });

            messageElement.appendChild(retryButton);
        }

        return appendMessageElement(messageElement);
    }

    /**
     * 添加加载动画消息
     */
    function addLoadingMessage() {
        const loadingMessage = addMessage('assistant', '');
        loadingMessage.innerHTML = '<span class="chat-loading"><span></span><span></span><span></span></span>';
        loadingMessage.classList.add('typing');
        return loadingMessage;
    }

    /**
     * 创建助手流式消息元素
     *
     * 用于流式响应时逐步更新内容
     */
    function createAssistantStreamingMessage(identifiers = {}) {
        const messageElement = buildMessageElement('assistant', 'assistant', identifiers);
        messageElement.classList.add('is-streaming');
        messageElement.textContent = '';
        return appendMessageElement(messageElement);
    }

    /**
     * 更新助手流式消息内容
     */
    function updateAssistantStreamingMessage(messageElement, text) {
        if (!messageElement || !messageElement.isConnected) {
            return;
        }

        messageElement.textContent = text;
        scrollToBottom(false);
    }

    /**
     * 完成助手流式消息
     *
     * 将流式消息标记为完成，渲染 Markdown 并添加复制按钮
     *
     * @param {HTMLElement} messageElement - 消息元素
     * @param {string} text - 最终文本
     * @param {Object} options - 选项
     * @param {boolean} options.interrupted - 是否被中断
     */
    function finalizeAssistantStreamingMessage(messageElement, text, { interrupted = false } = {}) {
        if (!messageElement || !messageElement.isConnected) {
            return;
        }

        messageElement.classList.remove('is-streaming');

        if (interrupted) {
            messageElement.classList.add('is-interrupted');
        } else {
            messageElement.classList.remove('is-interrupted');
        }

        if (!text) {
            messageElement.remove();
            return;
        }

        messageElement.innerHTML = renderMarkdown(text);
        addCopyButtons(messageElement);
        scrollToBottom(false);
    }

    /**
     * 添加错误消息
     *
     * @param {Object} params - 参数
     * @param {string} params.title - 错误标题
     * @param {string} params.detail - 错误详情
     * @param {string} params.actionLabel - 操作按钮文本
     * @param {Function} params.onAction - 操作按钮回调
     */
    function addErrorMessage({
        title,
        detail = '',
        actionLabel = '',
        onAction = null
    }) {
        const messageElement = buildMessageElement('error', 'error');

        const titleElement = document.createElement('div');
        titleElement.className = 'chat-error-title';
        titleElement.textContent = title;
        messageElement.appendChild(titleElement);

        if (detail) {
            const detailElement = document.createElement('div');
            detailElement.className = 'chat-error-detail';
            detailElement.textContent = detail;
            messageElement.appendChild(detailElement);
        }

        if (actionLabel && typeof onAction === 'function') {
            const actionButton = document.createElement('button');
            actionButton.type = 'button';
            actionButton.className = 'chat-error-action';
            actionButton.textContent = actionLabel;
            actionButton.addEventListener('click', onAction);
            messageElement.appendChild(actionButton);
        }

        return appendMessageElement(messageElement);
    }

    /**
     * 渲染完整对话
     *
     * 清空现有消息并渲染所有消息
     *
     * @param {Array} messages - 消息数组
     * @param {Function} resolveDisplayContent - 解析显示内容的函数
     */
    function renderConversation(messages, resolveDisplayContent) {
        clearMessages();

        messages.forEach((message) => {
            const displayContent = typeof resolveDisplayContent === 'function'
                ? resolveDisplayContent(message)
                : message.content;

            addMessage(message.role, displayContent, message.meta, {
                messageId: message.id,
                turnId: message.turnId
            });
        });
    }

    /**
     * 设置输入框启用状态
     */
    function setInputEnabled(enabled) {
        chatInput.disabled = !enabled;
        if (attachBtn && 'disabled' in attachBtn) {
            attachBtn.disabled = !enabled;
        }
        sendBtn.disabled = !enabled;
    }

    /**
     * 设置会话操作按钮启用状态
     */
    function setSessionActionsEnabled(enabled) {
        sessionActionButtons.forEach((button) => {
            if (button && 'disabled' in button) {
                button.disabled = !enabled;
            }
        });
    }

    /**
     * 设置流式响应 UI 状态
     *
     * 流式响应时：
     * - 显示停止按钮，隐藏发送按钮
     * - 禁用输入框和会话操作按钮
     *
     * 非流式响应时：
     * - 显示发送按钮，隐藏停止按钮
     * - 启用输入框和会话操作按钮
     */
    function setStreamingUI(streaming) {
        if (streaming) {
            stopBtn.style.display = '';
            sendBtn.style.display = 'none';
            setInputEnabled(false);
            setSessionActionsEnabled(false);
            return;
        }

        stopBtn.style.display = 'none';
        sendBtn.style.display = '';
        setInputEnabled(true);
        setSessionActionsEnabled(true);
    }

    /**
     * 添加系统通知
     *
     * @param {string} text - 通知文本
     * @param {number} removeAfterMs - 自动移除延迟（毫秒），0 表示不自动移除
     */
    function addSystemNotice(text, removeAfterMs = 0) {
        const notice = document.createElement('div');
        notice.className = 'chat-msg system';
        notice.textContent = text;
        messagesEl.appendChild(notice);
        scrollToBottom(false);

        if (removeAfterMs > 0) {
            setTimeout(() => notice.remove(), removeAfterMs);
        }

        return notice;
    }

    /**
     * 显示重试通知
     */
    function showRetryNotice(attempt, maxRetries, delayMs) {
        const seconds = (delayMs / 1000).toFixed(1);
        addSystemNotice(`Request failed. Retrying in ${seconds}s (${attempt}/${maxRetries})...`, delayMs + 500);
    }

    /**
     * 显示备用密钥通知
     */
    function showBackupKeyNotice() {
        addSystemNotice('Primary API key failed. Switching to backup key...', 3000);
    }

    return {
        addCopyButtons,
        addErrorMessage,
        addLoadingMessage,
        addMessage,
        addSystemNotice,
        clearMessages,
        createAssistantStreamingMessage,
        finalizeAssistantStreamingMessage,
        renderConversation,
        scrollToBottom,
        setStreamingUI,
        showRetryNotice,
        showBackupKeyNotice,
        updateAssistantStreamingMessage
    };
}
