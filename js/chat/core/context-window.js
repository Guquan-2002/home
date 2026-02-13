import { estimateTokenCount, getContextMessageContent, stripSourcesSection } from './message-model.js';

export function normalizeMaxContextMessages(value) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function truncateContentToTokenBudget(content, maxTokens) {
    if (!content || !Number.isFinite(maxTokens) || maxTokens <= 0) {
        return '';
    }

    let low = 0;
    let high = content.length;
    let best = '';

    while (low <= high) {
        const middle = Math.floor((low + high) / 2);
        const candidate = content.slice(0, middle);
        const tokenCount = estimateTokenCount(candidate) + 4;

        if (tokenCount <= maxTokens) {
            best = candidate;
            low = middle + 1;
        } else {
            high = middle - 1;
        }
    }

    return best.trim();
}

export function normalizeHistoryForContext(conversationHistory) {
    if (!Array.isArray(conversationHistory)) {
        return [];
    }

    return conversationHistory
        .filter((message) => message?.role === 'user' || message?.role === 'assistant')
        .map((message) => {
            const rawText = getContextMessageContent(message);
            const content = message.role === 'assistant'
                ? stripSourcesSection(rawText).trim()
                : rawText.trim();

            return {
                role: message.role,
                content,
                turnId: message.turnId
            };
        })
        .filter((message) => message.content.length > 0);
}

export function buildContextWindow(conversationHistory, maxContextTokens, maxContextMessages) {
    const normalizedHistory = normalizeHistoryForContext(conversationHistory);
    const safeMaxMessages = normalizeMaxContextMessages(maxContextMessages);

    let candidateHistory = normalizedHistory;
    let isTrimmed = false;

    if (safeMaxMessages && normalizedHistory.length > safeMaxMessages) {
        candidateHistory = normalizedHistory.slice(-safeMaxMessages);
        isTrimmed = true;
    }

    const safeMaxTokens = Number.isFinite(maxContextTokens) && maxContextTokens > 0
        ? maxContextTokens
        : 200000;

    if (!candidateHistory.length) {
        return {
            messages: [],
            isTrimmed,
            tokenCount: 0,
            inputBudgetTokens: safeMaxTokens,
            maxContextMessages: safeMaxMessages
        };
    }

    const reserveOutputTokens = Math.max(1024, Math.floor(safeMaxTokens * 0.2));
    const inputBudgetTokens = Math.max(1024, safeMaxTokens - reserveOutputTokens);

    const selected = [];
    let usedTokens = 0;

    for (let index = candidateHistory.length - 1; index >= 0; index -= 1) {
        const message = candidateHistory[index];
        const messageTokens = estimateTokenCount(message.content) + 4;
        const exceedsBudget = usedTokens + messageTokens > inputBudgetTokens;

        if (exceedsBudget) {
            isTrimmed = true;

            // Keep a truncated version of the newest message so the latest intent survives.
            if (selected.length === 0) {
                const truncatedContent = truncateContentToTokenBudget(message.content, inputBudgetTokens);
                if (truncatedContent) {
                    selected.push({ ...message, content: truncatedContent });
                    usedTokens = estimateTokenCount(truncatedContent) + 4;
                }
            }

            break;
        }

        selected.push(message);
        usedTokens += messageTokens;
    }

    return {
        messages: selected.reverse(),
        isTrimmed,
        tokenCount: usedTokens,
        inputBudgetTokens,
        maxContextMessages: safeMaxMessages
    };
}

export function buildContextPreview(messages, previewChars = 80) {
    return messages.map((message, index) => {
        const singleLine = message.content.replace(/\s+/g, ' ').trim();
        const text = singleLine.length > previewChars
            ? `${singleLine.slice(0, previewChars)}...`
            : singleLine;

        return {
            index,
            role: message.role,
            turnId: message.turnId,
            preview: text
        };
    });
}
