import { $ } from './utils.js';
import { CHAT_HISTORY_KEY, CHAT_LIMITS, CHAT_STORAGE_KEY } from './chat/constants.js';
import { createConfigManager } from './chat/config.js';
import { setupMarked, renderMarkdown, escapeHtml } from './chat/markdown.js';
import { createUiManager } from './chat/ui.js';
import { createHistoryManager } from './chat/history.js';
import { createApiManager } from './chat/api.js';
import { initCustomSelect } from './chat/custom-select.js';
import { createSessionStore } from './chat/state/session-store.js';
import { getMessageDisplayContent } from './chat/core/message-model.js';
import { createGeminiProvider } from './chat/providers/gemini-provider.js';

function getChatElements() {
    return {
        panel: $('#chat-panel'),
        toggleBtn: $('#chat-toggle'),
        closeBtn: $('#chat-close-btn'),
        clearBtn: $('#chat-clear-btn'),
        settingsBtn: $('#chat-settings-btn'),
        settingsDiv: $('#chat-settings'),
        settingsCloseBtn: $('#cfg-close-btn'),
        saveBtn: $('#cfg-save-btn'),
        historyBtn: $('#chat-history-btn'),
        historyDiv: $('#chat-history'),
        historyList: $('#chat-history-list'),
        newSessionBtn: $('#chat-new-session-btn'),
        clearAllBtn: $('#chat-clear-all-btn'),
        messagesEl: $('#chat-messages'),
        chatInput: $('#chat-input'),
        sendBtn: $('#chat-send-btn'),
        stopBtn: $('#chat-stop-btn'),
        cfgUrl: $('#cfg-api-url'),
        cfgKey: $('#cfg-api-key'),
        cfgBackupKey: $('#cfg-api-key-backup'),
        cfgModel: $('#cfg-model'),
        cfgPrompt: $('#cfg-system-prompt'),
        cfgThinkingBudget: $('#cfg-thinking-budget'),
        cfgSearchMode: $('#cfg-search-mode'),
        cfgPrefixWithTime: $('#cfg-prefix-with-time'),
        cfgPrefixWithName: $('#cfg-prefix-with-name'),
        cfgUserName: $('#cfg-user-name')
    };
}

function setupInputAutosize(chatInput) {
    chatInput.addEventListener('input', () => {
        chatInput.style.height = 'auto';
        chatInput.style.height = `${Math.min(chatInput.scrollHeight, 120)}px`;
    });
}

export function initChat() {
    const elements = getChatElements();
    const store = createSessionStore({
        storage: globalThis.localStorage,
        historyKey: CHAT_HISTORY_KEY
    });

    const configManager = createConfigManager({
        cfgUrl: elements.cfgUrl,
        cfgKey: elements.cfgKey,
        cfgBackupKey: elements.cfgBackupKey,
        cfgModel: elements.cfgModel,
        cfgPrompt: elements.cfgPrompt,
        cfgThinkingBudget: elements.cfgThinkingBudget,
        cfgSearchMode: elements.cfgSearchMode,
        cfgPrefixWithTime: elements.cfgPrefixWithTime,
        cfgPrefixWithName: elements.cfgPrefixWithName,
        cfgUserName: elements.cfgUserName
    }, CHAT_STORAGE_KEY);

    let historyManager = null;

    const renderActiveConversation = () => {
        ui.renderConversation(store.getActiveMessages(), getMessageDisplayContent);
    };

    const ui = createUiManager({
        elements: {
            messagesEl: elements.messagesEl,
            chatInput: elements.chatInput,
            sendBtn: elements.sendBtn,
            stopBtn: elements.stopBtn,
            sessionActionButtons: [
                elements.historyBtn,
                elements.clearBtn,
                elements.newSessionBtn,
                elements.clearAllBtn
            ]
        },
        renderMarkdown,
        maxRenderedMessages: CHAT_LIMITS.maxRenderedMessages,
        isRetryBlocked: () => store.isStreaming(),
        onRetryRequested: ({ turnId, content }) => {
            if (store.isStreaming()) {
                return;
            }

            const rollbackResult = store.rollbackToTurn(turnId);
            if (!rollbackResult) {
                return;
            }

            renderActiveConversation();
            elements.chatInput.value = rollbackResult.retryContent || content;
            elements.chatInput.style.height = 'auto';
            elements.chatInput.style.height = `${Math.min(elements.chatInput.scrollHeight, 120)}px`;
            elements.chatInput.focus();

            historyManager?.renderHistoryList();
        }
    });

    const notifySessionBusy = () => {
        ui.addSystemNotice('Please stop generation before switching or editing chat sessions.', 3000);
    };

    historyManager = createHistoryManager({
        store,
        elements: {
            historyDiv: elements.historyDiv,
            historyList: elements.historyList
        },
        onSessionActivated: () => {
            renderActiveConversation();
            historyManager.renderHistoryList();
        },
        isSessionOperationBlocked: () => store.isStreaming(),
        onBlockedSessionOperation: notifySessionBusy
    });

    const provider = createGeminiProvider({
        maxRetries: CHAT_LIMITS.maxRetries
    });

    const apiManager = createApiManager({
        store,
        elements: {
            chatInput: elements.chatInput,
            settingsDiv: elements.settingsDiv
        },
        ui,
        configManager,
        provider,
        constants: {
            connectTimeoutMs: CHAT_LIMITS.connectTimeoutMs,
            maxContextTokens: CHAT_LIMITS.maxContextTokens,
            maxContextMessages: CHAT_LIMITS.maxContextMessages
        },
        escapeHtml,
        onConversationUpdated: () => {
            historyManager.renderHistoryList();
        }
    });

    const openSettings = () => {
        elements.settingsDiv.classList.remove('chat-settings-hidden');
        elements.historyDiv.classList.add('chat-history-hidden');
        elements.cfgUrl.focus();
    };

    const closeSettings = () => {
        elements.settingsDiv.classList.add('chat-settings-hidden');
    };

    setupMarked();
    setupInputAutosize(elements.chatInput);

    elements.toggleBtn.addEventListener('click', () => {
        elements.panel.classList.remove('chat-hidden');
        if (elements.settingsDiv.classList.contains('chat-settings-hidden')) {
            elements.chatInput.focus();
        } else {
            elements.cfgUrl.focus();
        }
    });

    elements.closeBtn.addEventListener('click', () => {
        elements.panel.classList.add('chat-hidden');
        closeSettings();
    });

    elements.settingsBtn.addEventListener('click', () => {
        if (elements.settingsDiv.classList.contains('chat-settings-hidden')) {
            openSettings();
            return;
        }

        closeSettings();
    });

    elements.saveBtn.addEventListener('click', () => {
        configManager.saveConfig();
        closeSettings();
    });

    elements.settingsCloseBtn.addEventListener('click', closeSettings);

    elements.historyBtn.addEventListener('click', () => {
        if (store.isStreaming()) {
            notifySessionBusy();
            return;
        }

        elements.historyDiv.classList.toggle('chat-history-hidden');
        closeSettings();

        if (!elements.historyDiv.classList.contains('chat-history-hidden')) {
            historyManager.renderHistoryList();
        }
    });

    elements.newSessionBtn.addEventListener('click', () => {
        if (store.isStreaming()) {
            notifySessionBusy();
            return;
        }

        historyManager.createNewSession();
        elements.historyDiv.classList.add('chat-history-hidden');
        historyManager.renderHistoryList();
    });

    elements.clearAllBtn.addEventListener('click', () => {
        if (store.isStreaming()) {
            notifySessionBusy();
            return;
        }

        historyManager.clearAllSessions();
    });

    elements.clearBtn.addEventListener('click', () => {
        if (store.isStreaming()) {
            notifySessionBusy();
            return;
        }

        historyManager.createNewSession();
        ui.setStreamingUI(false);
        closeSettings();
    });

    elements.stopBtn.addEventListener('click', () => {
        apiManager.stopGeneration();
    });

    elements.sendBtn.addEventListener('click', apiManager.sendMessage);

    elements.chatInput.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' || event.shiftKey) return;
        event.preventDefault();
        apiManager.sendMessage();
    });

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && !elements.settingsDiv.classList.contains('chat-settings-hidden')) {
            closeSettings();
        }
    });

    configManager.loadConfig();
    initCustomSelect(elements.cfgSearchMode);

    store.initialize();
    renderActiveConversation();
    historyManager.renderHistoryList();
}
