// Chat bootstrap: wires chat UI, state, providers, config, and event handlers.
import { $ } from './utils.js';
import {
    CHAT_DRAFTS_KEY,
    CHAT_HISTORY_KEY,
    CHAT_LIMITS,
    CHAT_STORAGE_KEY,
    CHAT_PROVIDER_IDS
} from './chat/constants.js';
import { createConfigManager } from './chat/app/config-manager.js';
import { setupMarked, renderMarkdown } from './chat/ui/markdown.js';
import { createUiManager } from './chat/ui/ui-manager.js';
import { createHistoryManager } from './chat/session/history-manager.js';
import { createApiManager } from './chat/app/api-manager.js';
import { initCustomSelect } from './chat/ui/custom-select.js';
import { createSessionStore } from './chat/session/session-store.js';
import { getMessageDisplayContent } from './chat/core/message-model.js';
import { createGeminiProvider } from './chat/providers/vendors/gemini-provider.js';
import {
    createOpenAiProvider,
    createOpenAiResponsesProvider
} from './chat/providers/vendors/openai-provider.js';
import { createArkProvider } from './chat/providers/vendors/ark-provider.js';
import { createAnthropicProvider } from './chat/providers/vendors/anthropic-provider.js';
import { createProviderRouter } from './chat/providers/provider-router.js';
import { createDraftManager } from './chat/storage/draft-storage.js';

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
        attachBtn: $('#chat-attach-btn'),
        imageInput: $('#chat-image-input'),
        attachmentsEl: $('#chat-attachments'),
        sendBtn: $('#chat-send-btn'),
        stopBtn: $('#chat-stop-btn'),
        cfgProvider: $('#cfg-provider'),
        cfgUrl: $('#cfg-api-url'),
        cfgKey: $('#cfg-api-key'),
        cfgBackupKey: $('#cfg-api-key-backup'),
        cfgModel: $('#cfg-model'),
        cfgPrompt: $('#cfg-system-prompt'),
        cfgThinkingLevel: $('#cfg-thinking-level'),
        cfgThinkingLabel: $('#cfg-thinking-label'),
        cfgThinkingNote: $('#cfg-thinking-note'),
        cfgSearchMode: $('#cfg-search-mode'),
        cfgSearchLabel: $('#cfg-search-label'),
        cfgSearchNote: $('#cfg-search-note'),
        cfgEnablePseudoStream: $('#cfg-enable-pseudo-stream'),
        cfgEnableDraftAutosave: $('#cfg-enable-draft-autosave'),
        cfgPrefixWithTime: $('#cfg-prefix-with-time'),
        cfgPrefixWithName: $('#cfg-prefix-with-name'),
        cfgUserName: $('#cfg-user-name')
    };
}

function resizeChatInput(chatInput) {
    chatInput.style.height = 'auto';
    chatInput.style.height = `${Math.min(chatInput.scrollHeight, 120)}px`;
}

function setupInputAutosize(chatInput) {
    chatInput.addEventListener('input', () => {
        resizeChatInput(chatInput);
    });
}

function syncProviderPresentation(elements, providerId) {
    const isGemini = providerId === CHAT_PROVIDER_IDS.gemini;
    const isOpenAiCompletions = providerId === CHAT_PROVIDER_IDS.openai;
    const isOpenAiResponses = providerId === CHAT_PROVIDER_IDS.openaiResponses;
    const isOpenAi = isOpenAiCompletions || isOpenAiResponses;
    const isArk = providerId === CHAT_PROVIDER_IDS.arkResponses;
    const isAnthropic = providerId === CHAT_PROVIDER_IDS.anthropic;

    if (elements.cfgUrl) {
        elements.cfgUrl.placeholder = isOpenAi
            ? 'https://api.openai.com/v1'
            : isArk
                ? 'https://ark.cn-beijing.volces.com/api/v3/responses'
            : isAnthropic
                ? 'https://api.anthropic.com/v1'
                : 'https://generativelanguage.googleapis.com/v1beta';
    }

    if (elements.cfgKey) {
        elements.cfgKey.placeholder = isOpenAi
            ? 'sk-...'
            : isArk
                ? 'ark-...'
            : isAnthropic
                ? 'sk-ant-...'
                : 'AIza...';
    }

    if (elements.cfgBackupKey) {
        elements.cfgBackupKey.placeholder = isOpenAi
            ? 'sk-...'
            : isArk
                ? 'ark-...'
            : isAnthropic
                ? 'sk-ant-...'
                : 'AIza...';
    }

    if (elements.cfgModel) {
        elements.cfgModel.placeholder = isOpenAi
            ? 'gpt-4o-mini'
            : isArk
                ? 'doubao-seed-2-0-pro-260215'
            : isAnthropic
                ? 'claude-sonnet-4-5-20250929'
                : 'gemini-2.5-pro';
    }

    if (elements.cfgThinkingLabel) {
        elements.cfgThinkingLabel.textContent = (isOpenAi || isArk)
            ? 'Reasoning Effort (Optional)'
            : isAnthropic
                ? 'Thinking Effort (Optional)'
                : 'Thinking Level (Optional)';
    }

    if (elements.cfgThinkingNote) {
        elements.cfgThinkingNote.textContent = isOpenAi
            ? isOpenAiResponses
                ? 'OpenAI Responses: reasoning.effort supports none/minimal/low/medium/high/xhigh.'
                : 'OpenAI Chat Completions: reasoning_effort supports none/minimal/low/medium/high/xhigh.'
            : isArk
                ? 'Ark Responses: use thinking.type=enabled and reasoning.effort=minimal/low/medium/high.'
            : isAnthropic
                ? 'Anthropic adaptive thinking: use thinking.type=adaptive + output_config.effort; none disables thinking.'
                : 'Gemini 3 format: thinkingLevel supports off/low/medium/high.';
    }

    if (elements.cfgThinkingLevel) {
    if (isOpenAi || isArk || isGemini || isAnthropic) {
        elements.cfgThinkingLevel.type = 'text';
        elements.cfgThinkingLevel.inputMode = 'text';
        elements.cfgThinkingLevel.removeAttribute('min');
        elements.cfgThinkingLevel.removeAttribute('max');
        elements.cfgThinkingLevel.removeAttribute('step');
        elements.cfgThinkingLevel.placeholder = isGemini
            ? 'off / low / medium / high'
            : isAnthropic
                ? 'none / low / medium / high'
                : 'medium';
    } else {
        elements.cfgThinkingLevel.type = 'number';
        elements.cfgThinkingLevel.inputMode = 'numeric';
        elements.cfgThinkingLevel.min = '1';
        elements.cfgThinkingLevel.max = '100000';
        elements.cfgThinkingLevel.step = '256';
        elements.cfgThinkingLevel.placeholder = 'e.g. 2048';
    }
}if (elements.cfgSearchLabel) {
        elements.cfgSearchLabel.textContent = isOpenAi
            ? isOpenAiResponses
                ? 'Web Search (OpenAI Responses)'
                : 'Web Search (OpenAI Completions)'
            : isArk
                ? 'Web Search (Ark)'
            : isAnthropic
                ? 'Web Search (Anthropic)'
                : 'Web Search (Gemini)';
    }

    if (elements.cfgSearchNote) {
        elements.cfgSearchNote.textContent = isOpenAi
            ? isOpenAiResponses
                ? 'OpenAI Responses uses the basic web_search tool.'
                : 'OpenAI Chat Completions uses basic web_search_options.'
            : isArk
                ? 'Ark uses the built-in web_search tool (single mode).'
            : isAnthropic
                ? 'Anthropic format: built-in web_search tool.'
                : 'Gemini format: Google Search grounding.';
    }
}

export function initChat() {
    const elements = getChatElements();
    const store = createSessionStore({
        storage: globalThis.localStorage,
        historyKey: CHAT_HISTORY_KEY
    });
    const draftManager = createDraftManager({
        storage: globalThis.localStorage,
        storageKey: CHAT_DRAFTS_KEY
    });

    const configManager = createConfigManager({
        cfgProvider: elements.cfgProvider,
        cfgUrl: elements.cfgUrl,
        cfgKey: elements.cfgKey,
        cfgBackupKey: elements.cfgBackupKey,
        cfgModel: elements.cfgModel,
        cfgPrompt: elements.cfgPrompt,
        cfgThinkingLevel: elements.cfgThinkingLevel,
        cfgSearchMode: elements.cfgSearchMode,
        cfgEnablePseudoStream: elements.cfgEnablePseudoStream,
        cfgEnableDraftAutosave: elements.cfgEnableDraftAutosave,
        cfgPrefixWithTime: elements.cfgPrefixWithTime,
        cfgPrefixWithName: elements.cfgPrefixWithName,
        cfgUserName: elements.cfgUserName
    }, CHAT_STORAGE_KEY);

    let historyManager = null;
    let draftSaveTimerId = null;

    const getRuntimeConfig = () => configManager.getConfig();

    const renderActiveConversation = () => {
        ui.renderConversation(store.getActiveMessages(), getMessageDisplayContent);
    };

    const restoreDraftForActiveSession = () => {
        const config = getRuntimeConfig();
        if (!config.enableDraftAutosave) {
            elements.chatInput.value = '';
            resizeChatInput(elements.chatInput);
            return;
        }

        const activeSessionId = store.getActiveSessionId();
        const draftText = draftManager.getDraft(activeSessionId);
        elements.chatInput.value = draftText;
        resizeChatInput(elements.chatInput);
    };

    const scheduleDraftSave = () => {
        clearTimeout(draftSaveTimerId);

        const config = getRuntimeConfig();
        if (!config.enableDraftAutosave) {
            return;
        }

        const sessionId = store.getActiveSessionId();
        const draftText = elements.chatInput.value;

        draftSaveTimerId = setTimeout(() => {
            draftManager.setDraft(sessionId, draftText);
        }, 250);
    };

    const saveDraftImmediately = () => {
        clearTimeout(draftSaveTimerId);

        const config = getRuntimeConfig();
        if (!config.enableDraftAutosave) {
            return;
        }

        draftManager.setDraft(store.getActiveSessionId(), elements.chatInput.value);
    };

    const ui = createUiManager({
        elements: {
            messagesEl: elements.messagesEl,
            chatInput: elements.chatInput,
            attachBtn: elements.attachBtn,
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
            resizeChatInput(elements.chatInput);
            elements.chatInput.focus();
            saveDraftImmediately();

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
            restoreDraftForActiveSession();
            historyManager.renderHistoryList();
        },
        onSessionDeleted: (sessionId) => {
            draftManager.removeDraft(sessionId);
        },
        onSessionsCleared: () => {
            draftManager.clearAllDrafts();
        },
        isSessionOperationBlocked: () => store.isStreaming(),
        onBlockedSessionOperation: notifySessionBusy
    });

    const provider = createProviderRouter([
        createGeminiProvider({
            maxRetries: CHAT_LIMITS.maxRetries
        }),
        createOpenAiProvider({
            maxRetries: CHAT_LIMITS.maxRetries
        }),
        createOpenAiResponsesProvider({
            maxRetries: CHAT_LIMITS.maxRetries
        }),
        createArkProvider({
            maxRetries: CHAT_LIMITS.maxRetries
        }),
        createAnthropicProvider({
            maxRetries: CHAT_LIMITS.maxRetries
        })
    ]);

    const apiManager = createApiManager({
        store,
        elements: {
            chatInput: elements.chatInput,
            attachBtn: elements.attachBtn,
            imageInput: elements.imageInput,
            attachmentsEl: elements.attachmentsEl,
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
        onConversationUpdated: () => {
            historyManager.renderHistoryList();
        },
        onUserMessageAccepted: ({ sessionId }) => {
            clearTimeout(draftSaveTimerId);
            draftManager.removeDraft(sessionId);
            elements.sendBtn.classList.remove('has-text');
        }
    });

    const openSettings = () => {
        elements.settingsDiv.classList.remove('chat-settings-hidden');
        elements.historyDiv.classList.add('chat-history-hidden');
        if (elements.cfgProvider) {
            elements.cfgProvider.focus();
            return;
        }

        elements.cfgUrl.focus();
    };

    const closeSettings = () => {
        elements.settingsDiv.classList.add('chat-settings-hidden');
    };

    setupMarked();
    setupInputAutosize(elements.chatInput);

    elements.chatInput.addEventListener('input', scheduleDraftSave);
    elements.chatInput.addEventListener('input', () => {
        elements.sendBtn.classList.toggle('has-text', elements.chatInput.value.trim().length > 0);
    });
    elements.chatInput.addEventListener('blur', saveDraftImmediately);
    globalThis.addEventListener('beforeunload', saveDraftImmediately);

    elements.toggleBtn.addEventListener('click', () => {
        elements.panel.classList.remove('chat-hidden');
        requestAnimationFrame(() => {
            if (elements.settingsDiv.classList.contains('chat-settings-hidden')) {
                elements.chatInput.focus();
            } else {
                elements.cfgUrl.focus();
            }
        });
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

        const latestConfig = getRuntimeConfig();
        if (!latestConfig.enableDraftAutosave) {
            clearTimeout(draftSaveTimerId);
        }

        if (latestConfig.enableDraftAutosave && !elements.chatInput.value.trim()) {
            restoreDraftForActiveSession();
        }

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
    if (elements.cfgProvider) {
        syncProviderPresentation(elements, elements.cfgProvider.value || CHAT_PROVIDER_IDS.gemini);

        elements.cfgProvider.addEventListener('change', () => {
            const providerId = elements.cfgProvider.value || CHAT_PROVIDER_IDS.gemini;
            syncProviderPresentation(elements, providerId);
        });
    }

    initCustomSelect(elements.cfgProvider);
    initCustomSelect(elements.cfgSearchMode);
    store.initialize();
    renderActiveConversation();
    restoreDraftForActiveSession();
    historyManager.renderHistoryList();
}













