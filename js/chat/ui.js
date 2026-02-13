export function createUiManager({
    state,
    elements,
    renderMarkdown,
    maxRenderedMessages,
    onConversationHistoryMutated = null
}) {
    const {
        messagesEl,
        chatInput,
        sendBtn,
        stopBtn,
        sessionActionButtons = []
    } = elements;

    let handleConversationHistoryMutated = typeof onConversationHistoryMutated === 'function'
        ? onConversationHistoryMutated
        : () => {};

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

    function findLastMessageIndex(messages, role, content) {
        for (let index = messages.length - 1; index >= 0; index -= 1) {
            const message = messages[index];
            const displayContent = typeof message?.meta?.displayContent === 'string'
                ? message.meta.displayContent
                : '';

            if (message.role === role && (message.content === content || displayContent === content)) {
                return index;
            }
        }

        return -1;
    }

    function findHistoryIndexByMessageId(messages, role, messageId) {
        for (let index = 0; index < messages.length; index += 1) {
            const message = messages[index];
            if (message.role === role && message?.meta?.messageId === messageId) {
                return index;
            }
        }

        return -1;
    }

    function addMessage(role, text, meta = null) {
        const displayRole = typeof meta?.displayRole === 'string' ? meta.displayRole : role;
        const shouldShowRetry = role === 'user' && displayRole === 'user' && !meta?.isPrefixMessage;
        const message = document.createElement('div');
        message.className = `chat-msg ${displayRole}`;

        if (displayRole === 'assistant' && text) {
            message.innerHTML = renderMarkdown(text);
            addCopyButtons(message);
        } else {
            message.textContent = text;
        }

        if (shouldShowRetry) {
            const messageId = typeof meta?.messageId === 'string' ? meta.messageId : '';
            const retryButton = document.createElement('button');
            retryButton.className = 'msg-retry-btn';
            retryButton.innerHTML = '<i class="fas fa-redo"></i>';
            retryButton.title = 'Retry from this message';

            retryButton.addEventListener('click', () => {
                if (state.isStreaming) return;

                const domMessageIndex = Array.from(messagesEl.children).indexOf(message);
                if (domMessageIndex < 0) return;

                while (messagesEl.children.length > domMessageIndex) {
                    messagesEl.removeChild(messagesEl.lastChild);
                }

                let historyIndex = -1;
                if (messageId) {
                    historyIndex = findHistoryIndexByMessageId(state.conversationHistory, 'user', messageId);
                }

                if (historyIndex === -1) {
                    historyIndex = findLastMessageIndex(state.conversationHistory, 'user', text);
                }

                const rawUserText = historyIndex !== -1
                    ? (state.conversationHistory[historyIndex]?.content || text)
                    : text;

                if (historyIndex !== -1) {
                    state.conversationHistory.splice(historyIndex);
                    handleConversationHistoryMutated();
                }

                chatInput.value = rawUserText;
                chatInput.style.height = 'auto';
                chatInput.style.height = `${Math.min(chatInput.scrollHeight, 120)}px`;
                chatInput.focus();
            });

            message.appendChild(retryButton);
        }

        messagesEl.appendChild(message);
        pruneOldMessages();
        scrollToBottom(false);
        return message;
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

    function setStreamingUI(isStreaming) {
        if (isStreaming) {
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

    function setConversationHistoryMutatedHandler(handler) {
        handleConversationHistoryMutated = typeof handler === 'function'
            ? handler
            : () => {};
    }

    return {
        addCopyButtons,
        addMessage,
        addSystemNotice,
        scrollToBottom,
        setStreamingUI,
        setConversationHistoryMutatedHandler,
        showRetryNotice,
        showBackupKeyNotice
    };
}
