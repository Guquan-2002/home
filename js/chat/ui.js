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
        sendBtn,
        stopBtn,
        sessionActionButtons = []
    } = elements;

    const handleRetryRequested = typeof onRetryRequested === 'function'
        ? onRetryRequested
        : () => {};
    const retryBlocked = typeof isRetryBlocked === 'function'
        ? isRetryBlocked
        : () => false;

    function scrollToBottom(smooth = true) {
        messagesEl.scrollTo({
            top: messagesEl.scrollHeight,
            behavior: smooth ? 'smooth' : 'auto'
        });
    }

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
                        // Ignore clipboard failures.
                    });
            });

            pre.appendChild(button);
        });
    }

    function pruneOldMessages() {
        while (messagesEl.children.length > maxRenderedMessages) {
            messagesEl.removeChild(messagesEl.firstChild);
        }
    }

    function clearMessages() {
        messagesEl.innerHTML = '';
    }

    function addMessage(role, text, meta = null, identifiers = {}) {
        const displayRole = typeof meta?.displayRole === 'string' ? meta.displayRole : role;
        const shouldShowRetry = role === 'user' && displayRole === 'user' && !meta?.isPrefixMessage;

        const messageElement = document.createElement('div');
        messageElement.className = `chat-msg ${displayRole}`;

        const messageId = typeof identifiers?.messageId === 'string' ? identifiers.messageId : '';
        const turnId = typeof identifiers?.turnId === 'string' ? identifiers.turnId : '';

        if (messageId) {
            messageElement.dataset.messageId = messageId;
        }

        if (turnId) {
            messageElement.dataset.turnId = turnId;
        }

        if (displayRole === 'assistant' && text) {
            messageElement.innerHTML = renderMarkdown(text);
            addCopyButtons(messageElement);
        } else {
            messageElement.textContent = text;
        }

        if (shouldShowRetry && turnId) {
            const retryButton = document.createElement('button');
            retryButton.className = 'msg-retry-btn';
            retryButton.innerHTML = '<i class="fas fa-redo"></i>';
            retryButton.title = 'Retry from this message';

            retryButton.addEventListener('click', () => {
                if (retryBlocked()) {
                    return;
                }

                handleRetryRequested({
                    turnId,
                    messageId,
                    content: text
                });
            });

            messageElement.appendChild(retryButton);
        }

        messagesEl.appendChild(messageElement);
        pruneOldMessages();
        scrollToBottom(false);
        return messageElement;
    }

    function addLoadingMessage() {
        const loadingMessage = addMessage('assistant', '');
        loadingMessage.innerHTML = '<span class="chat-loading"><span></span><span></span><span></span></span>';
        loadingMessage.classList.add('typing');
        return loadingMessage;
    }

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

    function setInputEnabled(enabled) {
        chatInput.disabled = !enabled;
        sendBtn.disabled = !enabled;
    }

    function setSessionActionsEnabled(enabled) {
        sessionActionButtons.forEach((button) => {
            if (button && 'disabled' in button) {
                button.disabled = !enabled;
            }
        });
    }

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

    function showRetryNotice(attempt, maxRetries, delayMs) {
        const seconds = (delayMs / 1000).toFixed(1);
        addSystemNotice(`Request failed. Retrying in ${seconds}s (${attempt}/${maxRetries})...`, delayMs + 500);
    }

    function showBackupKeyNotice() {
        addSystemNotice('Primary API key failed. Switching to backup key...', 3000);
    }

    return {
        addCopyButtons,
        addLoadingMessage,
        addMessage,
        addSystemNotice,
        clearMessages,
        renderConversation,
        scrollToBottom,
        setStreamingUI,
        showRetryNotice,
        showBackupKeyNotice
    };
}
