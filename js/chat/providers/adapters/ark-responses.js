/**
 * Volcengine Ark Responses API adapter.
 * Converts normalized local messages into Ark Responses request payload.
 */

const ARK_THINKING_LEVELS = new Set(['minimal', 'low', 'medium', 'high']);

function asTrimmedString(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function normalizeApiUrl(apiUrl) {
    const trimmed = asTrimmedString(apiUrl).replace(/\/+$/, '');
    return trimmed || null;
}

function buildEndpoint(baseUrl) {
    return baseUrl.endsWith('/responses') ? baseUrl : `${baseUrl}/responses`;
}

function toResponsesImageUrl(image) {
    if (!image || typeof image !== 'object') {
        throw new Error('Ark Responses image part is invalid.');
    }

    if (image.sourceType === 'url' || image.sourceType === 'data_url') {
        return image.value;
    }

    if (image.sourceType === 'base64') {
        if (!image.mimeType) {
            throw new Error('Ark Responses base64 image part requires mimeType.');
        }

        return `data:${image.mimeType};base64,${image.value}`;
    }

    return '';
}

function toInputContentPart(part) {
    if (part.type === 'text') {
        return {
            type: 'input_text',
            text: part.text
        };
    }

    if (part.type === 'image') {
        const contentPart = {
            type: 'input_image'
        };

        if (part.image.sourceType === 'file_id') {
            contentPart.file_id = part.image.value;
        } else {
            const imageUrl = toResponsesImageUrl(part.image);
            if (!imageUrl) {
                throw new Error(`Ark Responses does not support image sourceType "${part.image.sourceType}".`);
            }
            contentPart.image_url = imageUrl;
        }

        if (part.image.detail) {
            contentPart.detail = part.image.detail;
        }

        return contentPart;
    }

    return null;
}

export function buildArkResponsesRequest({
    config,
    envelope,
    stream = false,
    apiKey
}) {
    const baseUrl = normalizeApiUrl(config?.apiUrl);
    if (!baseUrl) {
        throw new Error('Ark API URL is required.');
    }

    const endpoint = buildEndpoint(baseUrl);
    const input = envelope.messages.map((message) => ({
        type: 'message',
        role: message.role === 'assistant' ? 'assistant' : 'user',
        content: message.parts
            .map((part) => toInputContentPart(part))
            .filter(Boolean)
    }));

    const body = {
        model: config.model,
        input,
        stream
    };

    if (envelope.systemInstruction) {
        body.instructions = envelope.systemInstruction;
    }

    const thinkingBudget = typeof config?.thinkingBudget === 'string'
        ? config.thinkingBudget.trim().toLowerCase()
        : '';
    if (ARK_THINKING_LEVELS.has(thinkingBudget)) {
        body.thinking = {
            type: 'enabled'
        };
        body.reasoning = {
            effort: thinkingBudget
        };
    }

    if (config?.searchMode === 'ark_web_search') {
        body.tools = [{
            type: 'web_search'
        }];
    }

    return {
        endpoint,
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`
        },
        body
    };
}
