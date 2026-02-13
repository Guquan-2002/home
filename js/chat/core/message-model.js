import {
    ASSISTANT_SEGMENT_MARKER,
    ASSISTANT_SENTENCE_MARKER,
    SOURCES_MARKDOWN_MARKER
} from '../constants.js';

export const DEFAULT_SESSION_TITLE = 'New chat';

const VALID_ROLES = new Set(['user', 'assistant']);
const VALID_DISPLAY_ROLES = new Set(['system', 'assistant', 'user', 'error']);

function asTrimmedString(value) {
    return typeof value === 'string' ? value.trim() : '';
}

export function createEntityId(prefix) {
    if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
        return `${prefix}_${globalThis.crypto.randomUUID()}`;
    }

    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function createMessageId() {
    return createEntityId('msg');
}

export function createTurnId() {
    return createEntityId('turn');
}

export function estimateTokenCount(text) {
    const safeText = typeof text === 'string' ? text : '';
    const cjkChars = (safeText.match(/[\u4e00-\u9fff\u3000-\u303f]/g) || []).length;
    const otherChars = safeText.length - cjkChars;
    return Math.ceil(cjkChars / 1.5 + otherChars / 4);
}

export function stripSourcesSection(text) {
    if (typeof text !== 'string') return '';

    const sourcesIndex = text.lastIndexOf(SOURCES_MARKDOWN_MARKER);
    if (sourcesIndex === -1) {
        return text;
    }

    return text.slice(0, sourcesIndex).trimEnd();
}

export function splitAssistantMessageByMarker(text, {
    enableMarkerSplit = false
} = {}) {
    const rawText = typeof text === 'string' ? text : '';

    if (!enableMarkerSplit) {
        const fallbackText = rawText.trim();
        if (fallbackText) {
            return [fallbackText];
        }

        return ['(No response text)'];
    }

    const segments = rawText
        .split(ASSISTANT_SEGMENT_MARKER)
        .flatMap((segment) => segment.split(ASSISTANT_SENTENCE_MARKER))
        .map((segment) => segment.trim())
        .filter(Boolean);

    if (segments.length > 0) {
        return segments;
    }

    const fallback = rawText.trim();
    if (fallback) {
        return [fallback];
    }

    return ['(No response text)'];
}

function normalizeDisplayRole(displayRole, fallbackRole) {
    if (VALID_DISPLAY_ROLES.has(displayRole)) {
        return displayRole;
    }

    if (fallbackRole === 'assistant' || fallbackRole === 'user') {
        return fallbackRole;
    }

    return '';
}

function normalizeMessageCore(rawMessage) {
    if (!rawMessage || !VALID_ROLES.has(rawMessage.role)) {
        return null;
    }

    const rawMeta = rawMessage.meta && typeof rawMessage.meta === 'object' ? rawMessage.meta : {};
    const rawContent = typeof rawMessage.content === 'string' ? rawMessage.content : '';
    const fallbackDisplay = typeof rawMeta.displayContent === 'string' ? rawMeta.displayContent : '';

    const normalizedContent = rawMessage.role === 'assistant'
        ? stripSourcesSection(rawContent || fallbackDisplay).trim()
        : (rawContent || fallbackDisplay).trim();

    if (!normalizedContent) {
        return null;
    }

    const normalizedDisplayContent = rawMessage.role === 'assistant'
        ? stripSourcesSection(fallbackDisplay || rawContent)
        : (fallbackDisplay || rawContent);

    return {
        role: rawMessage.role,
        content: normalizedContent,
        rawMeta,
        displayContent: normalizedDisplayContent
    };
}

export function buildMessageMeta(content, {
    messageId = '',
    turnId = '',
    displayContent = '',
    contextContent = '',
    createdAt = Date.now(),
    tokenEstimate = null,
    displayRole = '',
    isPrefixMessage = false,
    prefixType = '',
    interrupted = false
} = {}) {
    const normalizedContent = typeof content === 'string' ? content : '';
    const normalizedContextContent = asTrimmedString(contextContent);
    const contextForTokenEstimate = normalizedContextContent || normalizedContent;
    const computedTokenEstimate = Number.isFinite(tokenEstimate) && tokenEstimate > 0
        ? tokenEstimate
        : estimateTokenCount(contextForTokenEstimate) + 4;

    const meta = {
        messageId: asTrimmedString(messageId),
        turnId: asTrimmedString(turnId),
        createdAt: Number.isFinite(createdAt) && createdAt > 0 ? createdAt : Date.now(),
        tokenEstimate: computedTokenEstimate
    };

    const normalizedDisplayContent = typeof displayContent === 'string' ? displayContent : '';
    if (normalizedDisplayContent && normalizedDisplayContent !== normalizedContent) {
        meta.displayContent = normalizedDisplayContent;
    }

    if (normalizedContextContent && normalizedContextContent !== normalizedContent) {
        meta.contextContent = normalizedContextContent;
    }

    const normalizedDisplayRole = normalizeDisplayRole(displayRole, '');
    if (normalizedDisplayRole) {
        meta.displayRole = normalizedDisplayRole;
    }

    if (isPrefixMessage === true) {
        meta.isPrefixMessage = true;
    }

    const normalizedPrefixType = asTrimmedString(prefixType);
    if (normalizedPrefixType) {
        meta.prefixType = normalizedPrefixType;
    }

    if (interrupted === true) {
        meta.interrupted = true;
    }

    return meta;
}

export function createChatMessage({
    role,
    content,
    turnId,
    id,
    metaOptions = {}
}) {
    if (!VALID_ROLES.has(role)) {
        throw new Error('Chat message role must be "user" or "assistant".');
    }

    const normalizedTurnId = asTrimmedString(turnId) || createTurnId();
    const messageId = asTrimmedString(id) || createMessageId();
    const normalizedContent = role === 'assistant'
        ? stripSourcesSection(typeof content === 'string' ? content : '').trim()
        : asTrimmedString(content);

    if (!normalizedContent) {
        throw new Error('Chat message content cannot be empty.');
    }

    const meta = buildMessageMeta(normalizedContent, {
        ...metaOptions,
        messageId,
        turnId: normalizedTurnId
    });

    return {
        id: messageId,
        turnId: normalizedTurnId,
        role,
        content: normalizedContent,
        meta
    };
}

export function normalizeChatMessage(rawMessage, {
    defaultTurnId = '',
    defaultCreatedAt = Date.now()
} = {}) {
    const normalizedCore = normalizeMessageCore(rawMessage);
    if (!normalizedCore) {
        return null;
    }

    const normalizedTurnId = asTrimmedString(rawMessage.turnId)
        || asTrimmedString(normalizedCore.rawMeta.turnId)
        || asTrimmedString(defaultTurnId)
        || createTurnId();

    const normalizedMessageId = asTrimmedString(rawMessage.id)
        || asTrimmedString(normalizedCore.rawMeta.messageId)
        || createMessageId();

    const meta = buildMessageMeta(normalizedCore.content, {
        messageId: normalizedMessageId,
        turnId: normalizedTurnId,
        displayContent: normalizedCore.displayContent,
        contextContent: typeof normalizedCore.rawMeta.contextContent === 'string' ? normalizedCore.rawMeta.contextContent : '',
        createdAt: Number.isFinite(normalizedCore.rawMeta.createdAt) ? normalizedCore.rawMeta.createdAt : defaultCreatedAt,
        tokenEstimate: Number.isFinite(normalizedCore.rawMeta.tokenEstimate) ? normalizedCore.rawMeta.tokenEstimate : null,
        displayRole: normalizedCore.rawMeta.displayRole,
        isPrefixMessage: normalizedCore.rawMeta.isPrefixMessage === true,
        prefixType: normalizedCore.rawMeta.prefixType,
        interrupted: normalizedCore.rawMeta.interrupted === true
    });

    return {
        id: normalizedMessageId,
        turnId: normalizedTurnId,
        role: normalizedCore.role,
        content: normalizedCore.content,
        meta
    };
}

export function cloneChatMessage(message) {
    return {
        id: message.id,
        turnId: message.turnId,
        role: message.role,
        content: message.content,
        meta: message.meta ? { ...message.meta } : undefined
    };
}

export function cloneChatMessages(messages) {
    return messages.map(cloneChatMessage);
}

export function getMessageDisplayContent(message) {
    if (typeof message?.meta?.displayContent === 'string') {
        return message.meta.displayContent;
    }

    return typeof message?.content === 'string' ? message.content : '';
}

export function getContextMessageContent(message) {
    if (typeof message?.meta?.contextContent === 'string' && message.meta.contextContent) {
        return message.meta.contextContent;
    }

    if (typeof message?.content === 'string' && message.content) {
        return message.content;
    }

    if (typeof message?.meta?.displayContent === 'string') {
        return stripSourcesSection(message.meta.displayContent);
    }

    return '';
}

export function buildSessionTitle(messages) {
    const firstUserMessage = messages.find((message) => (
        message.role === 'user' && message?.meta?.isPrefixMessage !== true
    ));

    if (!firstUserMessage) {
        return DEFAULT_SESSION_TITLE;
    }

    const plainText = asTrimmedString(firstUserMessage.content);
    if (!plainText) {
        return DEFAULT_SESSION_TITLE;
    }

    return plainText.length > 30 ? `${plainText.slice(0, 30)}...` : plainText;
}
