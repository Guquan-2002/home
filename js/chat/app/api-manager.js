/**
 * Chat API manager entry.
 *
 * Responsibility:
 * - Wire provider/store/ui/config dependencies
 * - Compose message submitter, attachment handling, and assistant response flow
 * - Keep public API stable: createApiManager -> { sendMessage, stopGeneration }
 */
import { assertProvider } from '../providers/provider-interface.js';
import { createAttachmentManager } from './api-manager/attachments.js';
import { createAssistantResponseManager } from './api-manager/assistant-response.js';
import { createMessageSubmitter } from './api-manager/message-submitter.js';

export function createApiManager({
    store,
    elements,
    ui,
    configManager,
    provider,
    constants,
    onConversationUpdated = null,
    onUserMessageAccepted = null
}) {
    const providerClient = assertProvider(provider);
    const {
        chatInput,
        settingsDiv
    } = elements;

    const attachmentManager = createAttachmentManager({
        elements,
        ui
    });
    const assistantResponseManager = createAssistantResponseManager({
        store,
        ui,
        providerClient,
        constants,
        chatInput,
        onConversationUpdated
    });
    const messageSubmitter = createMessageSubmitter({
        store,
        ui,
        configManager,
        chatInput,
        settingsDiv,
        attachments: attachmentManager,
        generateAssistantResponse: assistantResponseManager.generateAssistantResponse,
        onConversationUpdated,
        onUserMessageAccepted
    });

    attachmentManager.bindAttachmentEvents();
    attachmentManager.renderAttachmentPreview();

    function stopGeneration() {
        store.requestAbort('user');
    }

    return {
        sendMessage: messageSubmitter.sendMessage,
        stopGeneration
    };
}

