/**
 * API manager message submitter.
 *
 * Responsibility:
 * - Validate user input/config before sending
 * - Build user messages with prefix/timestamp/image parts
 * - Append user messages and trigger assistant response generation
 */
import { createChatMessage, createTurnId, getMessageDisplayContent } from '../../core/message-model.js';
import { applyMessagePrefix, buildMessagePrefix, buildTimestampPrefix } from '../../core/prefix.js';
import { formatAttachmentNotice } from './attachments.js';

function resizeInputToContent(chatInput) {
    chatInput.style.height = 'auto';
    chatInput.style.height = `${Math.min(chatInput.scrollHeight, 120)}px`;
}

export function createMessageSubmitter({
    store,
    ui,
    configManager,
    chatInput,
    settingsDiv,
    attachments,
    generateAssistantResponse,
    onConversationUpdated = null,
    onUserMessageAccepted = null
}) {
    function notifyConversationUpdated() {
        if (typeof onConversationUpdated === 'function') {
            onConversationUpdated();
        }
    }

    function appendMessagesToUi(messages) {
        messages.forEach((message) => {
            ui.addMessage(message.role, getMessageDisplayContent(message), message.meta, {
                messageId: message.id,
                turnId: message.turnId
            });
        });
    }

    async function sendMessage() {
        const text = chatInput.value.trim();
        if (store.isStreaming()) {
            return;
        }

        const pendingImageParts = attachments.getPendingImageParts();
        const hasImages = pendingImageParts.length > 0;
        if (!text && !hasImages) {
            return;
        }

        const config = configManager.getConfig();
        const providerLabelMap = {
            gemini: 'Gemini',
            openai: 'OpenAI Chat Completions',
            openai_responses: 'OpenAI Responses',
            ark_responses: 'Volcengine Ark Responses',
            anthropic: 'Anthropic'
        };
        const providerLabel = providerLabelMap[config.provider] || 'provider';

        if (!config.apiKey && !config.backupApiKey) {
            ui.addMessage('error', `Please set at least one ${providerLabel} API key in settings.`);
            settingsDiv.classList.remove('chat-settings-hidden');
            return;
        }

        if (!config.model) {
            ui.addMessage('error', `Please set a ${providerLabel} model name in settings.`);
            settingsDiv.classList.remove('chat-settings-hidden');
            return;
        }

        const activeSessionId = store.getActiveSessionId();
        if (typeof onUserMessageAccepted === 'function') {
            onUserMessageAccepted({
                sessionId: activeSessionId,
                text
            });
        }

        const userCreatedAt = Date.now();
        const turnId = createTurnId();

        const timestampPrefix = buildTimestampPrefix(config, userCreatedAt);
        const userNamePrefix = buildMessagePrefix(config);
        const userContextText = text
            ? applyMessagePrefix(text, userNamePrefix)
            : (userNamePrefix || '');
        const parts = [];
        if (text) {
            parts.push({
                type: 'text',
                text: userContextText || text
            });
        }
        if (!text && hasImages && userContextText) {
            parts.push({
                type: 'text',
                text: userContextText
            });
        }
        if (hasImages) {
            parts.push(...pendingImageParts);
        }
        const contentFallback = text || (hasImages ? '[Image]' : '');
        const displayContent = text
            ? userContextText
            : (
                userContextText
                    ? applyMessagePrefix(formatAttachmentNotice(pendingImageParts.length), userContextText)
                    : formatAttachmentNotice(pendingImageParts.length)
            );

        const messagesToAppend = [];

        if (timestampPrefix) {
            messagesToAppend.push(createChatMessage({
                role: 'user',
                content: timestampPrefix,
                turnId,
                metaOptions: {
                    displayContent: timestampPrefix,
                    contextContent: timestampPrefix,
                    createdAt: userCreatedAt,
                    displayRole: 'system',
                    isPrefixMessage: true,
                    prefixType: 'timestamp'
                }
            }));
        }

        messagesToAppend.push(createChatMessage({
            role: 'user',
            content: contentFallback,
            turnId,
            metaOptions: {
                displayContent,
                contextContent: userContextText || contentFallback,
                parts,
                createdAt: userCreatedAt
            }
        }));

        store.appendMessages(messagesToAppend);
        appendMessagesToUi(messagesToAppend);
        notifyConversationUpdated();

        chatInput.value = '';
        attachments.clearPendingImages();
        resizeInputToContent(chatInput);

        await generateAssistantResponse(config, turnId, text);
    }

    return {
        sendMessage
    };
}

