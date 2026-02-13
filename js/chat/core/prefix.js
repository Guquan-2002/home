function formatPrefixTimestamp(timestamp) {
    const date = new Date(timestamp);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    return `[${year}-${month}-${day} ${hours}:${minutes}:${seconds}]`;
}

function formatNameTag(name) {
    const trimmed = typeof name === 'string' ? name.trim() : '';
    if (!trimmed) return '';

    const hasAsciiBrackets = trimmed.startsWith('[') && trimmed.endsWith(']');
    const hasCjkBrackets = trimmed.startsWith('【') && trimmed.endsWith('】');

    const normalized = hasAsciiBrackets || hasCjkBrackets
        ? trimmed.slice(1, -1).trim()
        : trimmed;

    if (!normalized) return '';
    return `【${normalized}】`;
}

export function buildNamePrefix(config) {
    if (!config?.prefixWithName) {
        return '';
    }

    return formatNameTag(config.userName);
}

export function buildTimestampPrefix(config, timestamp) {
    if (!config?.prefixWithTime) {
        return '';
    }

    return formatPrefixTimestamp(timestamp);
}

export function buildMessagePrefix(config) {
    const tags = [];

    const nameTag = buildNamePrefix(config);
    if (nameTag) {
        tags.push(nameTag);
    }

    return tags.join('\n');
}

export function applyMessagePrefix(content, prefix) {
    const normalizedContent = typeof content === 'string' ? content : '';
    if (!prefix) {
        return normalizedContent;
    }

    return `${prefix}\n${normalizedContent}`;
}
