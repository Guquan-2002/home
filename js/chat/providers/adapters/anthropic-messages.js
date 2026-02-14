/**
 * Anthropic Messages API adapter.
 * Converts normalized local messages into Anthropic Messages request payload.
 */
import { parseImageDataUrl } from '../../core/local-message.js';

const ANTHROPIC_API_VERSION = '2023-06-01';
const DEFAULT_MAX_TOKENS = 4096;
const ANTHROPIC_WEB_SEARCH_TOOL_TYPE = 'web_search_20250305';
const ANTHROPIC_WEB_SEARCH_TOOL_NAME = 'web_search';

function asTrimmedString(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function normalizeApiUrl(apiUrl) {
    const trimmed = asTrimmedString(apiUrl).replace(/\/+$/, '');
    return trimmed || null;
}

function normalizeThinkingEffort(rawValue) {
    if (typeof rawValue !== 'string') {
        return null;
    }

    const normalized = rawValue.trim();
    return normalized || null;
}

function isThinkingDisabledByEffort(effort) {
    return !effort || effort.toLowerCase() === 'none';
}

function resolveMaxTokens(config) {
    const parsed = Number.parseInt(config?.maxTokens, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
        return parsed;
    }

    return DEFAULT_MAX_TOKENS;
}

function buildAnthropicWebSearchTools(searchMode) {
    if (searchMode !== 'anthropic_web_search') {
        return undefined;
    }

    // Keep the tool payload minimal and rely on Anthropic defaults.
    return [{
        type: ANTHROPIC_WEB_SEARCH_TOOL_TYPE,
        name: ANTHROPIC_WEB_SEARCH_TOOL_NAME
    }];
}

function toAnthropicContentPart(part) {
    if (part.type === 'text') {
        return {
            type: 'text',
            text: part.text
        };
    }

    if (part.type === 'image') {
        if (part.image.sourceType === 'url') {
            return {
                type: 'image',
                source: {
                    type: 'url',
                    url: part.image.value
                }
            };
        }

        if (part.image.sourceType === 'data_url') {
            const parsedDataUrl = parseImageDataUrl(part.image.value);
            if (!parsedDataUrl) {
                throw new Error('Anthropic image data_url must be a valid base64 data URL.');
            }

            return {
                type: 'image',
                source: {
                    type: 'base64',
                    media_type: parsedDataUrl.mimeType,
                    data: parsedDataUrl.data
                }
            };
        }

        if (part.image.sourceType === 'base64') {
            if (!part.image.mimeType) {
                throw new Error('Anthropic base64 image part requires mimeType.');
            }

            return {
                type: 'image',
                source: {
                    type: 'base64',
                    media_type: part.image.mimeType,
                    data: part.image.value
                }
            };
        }

        throw new Error(`Anthropic does not support image sourceType "${part.image.sourceType}".`);
    }

    return null;
}

export function buildAnthropicMessagesRequest({
    config,
    envelope,
    stream = false,
    apiKey
}) {
    const baseUrl = normalizeApiUrl(config?.apiUrl);
    if (!baseUrl) {
        throw new Error('Anthropic API URL is required.');
    }

    const thinkingEffort = normalizeThinkingEffort(config?.thinkingEffort);
    const body = {
        model: config.model,
        max_tokens: resolveMaxTokens(config),
        stream,
        messages: envelope.messages.map((message) => ({
            role: message.role === 'assistant' ? 'assistant' : 'user',
            content: message.parts
                .map((part) => toAnthropicContentPart(part))
                .filter(Boolean)
        }))
    };

    if (envelope.systemInstruction) {
        body.system = envelope.systemInstruction;
    }

    if (!isThinkingDisabledByEffort(thinkingEffort)) {
        body.thinking = {
            type: 'adaptive'
        };
        body.output_config = {
            effort: thinkingEffort
        };
    }

    const webSearchTools = buildAnthropicWebSearchTools(config?.searchMode);
    if (webSearchTools) {
        body.tools = webSearchTools;
    }

    return {
        endpoint: `${baseUrl}/messages`,
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': ANTHROPIC_API_VERSION
        },
        body
    };
}
