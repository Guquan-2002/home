/**
 * 上下文窗口构建器
 *
 * 职责：
 * - 根据 Token 和消息数量限制裁剪对话历史
 * - 规范化历史消息为统一格式（支持文本和多模态消息）
 * - 构建适配不同 Provider 的上下文窗口
 * - 提供上下文预览功能
 * - 智能截断超长消息以适应 Token 预算
 *
 * 依赖：message-model.js, local-message.js
 * 被依赖：api-manager, provider-router
 */

// Context window builder: trims and normalizes history to fit model token/message budgets.
import { estimateTokenCount, getContextMessageContent, stripSourcesSection } from './message-model.js';
import { getLocalMessageText, hasImageParts, normalizeLocalMessage } from './local-message.js';

// 图片在上下文中的占位符文本
const IMAGE_CONTEXT_PLACEHOLDER = '[image]';

/**
 * 规范化最大上下文消息数
 * @param {*} value - 原始值
 * @returns {number|null} 有效的正整数或 null
 */
export function normalizeMaxContextMessages(value) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/**
 * 将内容截断到指定的 Token 预算
 * @param {string} content - 原始内容
 * @param {number} maxTokens - 最大 Token 数
 * @returns {string} 截断后的内容
 *
 * 算法：使用二分查找找到最大可用长度，确保截断后的内容不超过 Token 限制
 */
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

/**
 * 规范化对话历史为上下文格式（纯文本格式）
 * @param {Array} conversationHistory - 原始对话历史
 * @returns {Array} 规范化后的消息数组 [{ role, content, turnId }]
 *
 * 处理逻辑：
 * - 只保留 user 和 assistant 角色的消息
 * - 移除 assistant 消息中的 Sources 部分
 * - 过滤掉空内容的消息
 */
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

/**
 * 规范化对话历史为本地消息格式（支持多模态）
 * @param {Array} conversationHistory - 原始对话历史
 * @returns {Array} 规范化后的本地消息数组
 *
 * 处理逻辑：
 * - 只保留 user 和 assistant 角色的消息
 * - 尝试从 meta.parts 中恢复多模态内容
 * - 移除 assistant 消息中的 Sources 部分
 * - 使用 normalizeLocalMessage 进行规范化
 */
export function normalizeHistoryForLocalMessages(conversationHistory) {
    if (!Array.isArray(conversationHistory)) {
        return [];
    }

    return conversationHistory
        .filter((message) => message?.role === 'user' || message?.role === 'assistant')
        .map((message) => {
            const rawText = getContextMessageContent(message);
            const fallbackText = message.role === 'assistant'
                ? stripSourcesSection(rawText).trim()
                : rawText.trim();

            return normalizeLocalMessage({
                role: message.role,
                turnId: message.turnId,
                parts: Array.isArray(message?.meta?.parts) ? message.meta.parts : undefined,
                content: fallbackText,
                meta: message?.meta
            });
        })
        .filter(Boolean);
}

/**
 * 估算本地消息的 Token 数量
 * @param {Object} message - 本地消息对象
 * @returns {number} 估算的 Token 数量（包含 4 个 Token 的消息开销）
 */
function estimateLocalMessageTokens(message) {
    const text = getLocalMessageText(message, {
        imagePlaceholder: IMAGE_CONTEXT_PLACEHOLDER
    });
    return estimateTokenCount(text) + 4;
}

/**
 * 将本地消息截断到指定的 Token 预算
 * @param {Object} message - 本地消息对象
 * @param {number} maxTokens - 最大 Token 数
 * @returns {Object|null} 截断后的消息或 null
 *
 * 截断策略：
 * - 如果消息已在预算内，直接返回
 * - 保留所有图片部分
 * - 截断文本部分以适应剩余预算
 * - 如果截断后无内容，返回 null
 */
function truncateLocalMessageToTokenBudget(message, maxTokens) {
    const normalizedMessage = normalizeLocalMessage(message);
    if (!normalizedMessage || !Number.isFinite(maxTokens) || maxTokens <= 0) {
        return null;
    }

    const messageTokenCount = estimateLocalMessageTokens(normalizedMessage);
    if (messageTokenCount <= maxTokens) {
        return normalizedMessage;
    }

    const plainText = getLocalMessageText(normalizedMessage);
    const imageOnlyCost = hasImageParts(normalizedMessage)
        ? estimateTokenCount(IMAGE_CONTEXT_PLACEHOLDER) + 4
        : 0;
    const textBudget = Math.max(1, maxTokens - imageOnlyCost);
    const truncatedText = truncateContentToTokenBudget(plainText, textBudget);

    const truncatedParts = normalizedMessage.parts.filter((part) => part.type === 'image');
    if (truncatedText) {
        truncatedParts.push({
            type: 'text',
            text: truncatedText
        });
    }

    if (truncatedParts.length === 0) {
        return null;
    }

    return {
        ...normalizedMessage,
        parts: truncatedParts
    };
}

/**
 * 规范化系统指令
 * @param {Object} config - 配置对象
 * @returns {string} 规范化后的系统指令
 */
function normalizeSystemInstruction(config) {
    if (typeof config?.systemPrompt !== 'string') {
        return '';
    }

    return config.systemPrompt.trim();
}

/**
 * 构建上下文窗口（纯文本格式）
 * @param {Array} conversationHistory - 对话历史
 * @param {number} maxContextTokens - 最大上下文 Token 数
 * @param {number} maxContextMessages - 最大上下文消息数
 * @returns {Object} 上下文窗口对象
 *
 * 返回格式：
 * {
 *   messages: Array,           // 选中的消息列表
 *   isTrimmed: boolean,        // 是否进行了裁剪
 *   tokenCount: number,        // 实际使用的 Token 数
 *   inputBudgetTokens: number, // 输入预算 Token 数
 *   maxContextMessages: number // 最大消息数限制
 * }
 *
 * 裁剪策略：
 * 1. 先按消息数量限制裁剪（保留最新的 N 条消息）
 * 2. 再按 Token 预算裁剪（从最新消息开始向前选择）
 * 3. 为输出预留 20% 的 Token（最少 1024）
 * 4. 如果最新消息超出预算，截断该消息以保留用户意图
 */
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

/**
 * 构建本地消息信封（支持多模态）
 * @param {Array} conversationHistory - 对话历史
 * @param {Object} config - 配置对象（包含 systemPrompt 等）
 * @param {Object} options - 选项
 * @param {number} options.maxContextTokens - 最大上下文 Token 数（默认 200000）
 * @param {number} options.maxContextMessages - 最大上下文消息数（默认 120）
 * @returns {Object} 本地消息信封对象
 *
 * 返回格式：
 * {
 *   systemInstruction: string, // 系统指令
 *   messages: Array,           // 本地消息列表（支持多模态）
 *   isTrimmed: boolean,        // 是否进行了裁剪
 *   tokenCount: number,        // 实际使用的 Token 数
 *   inputBudgetTokens: number, // 输入预算 Token 数
 *   maxContextMessages: number // 最大消息数限制
 * }
 *
 * 裁剪策略：与 buildContextWindow 相同，但支持多模态消息
 */
export function buildLocalMessageEnvelope(conversationHistory, config = {}, {
    maxContextTokens = 200000,
    maxContextMessages = 120
} = {}) {
    const normalizedHistory = normalizeHistoryForLocalMessages(conversationHistory);
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
            systemInstruction: normalizeSystemInstruction(config),
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
        const messageTokens = estimateLocalMessageTokens(message);
        const exceedsBudget = usedTokens + messageTokens > inputBudgetTokens;

        if (exceedsBudget) {
            isTrimmed = true;

            // Keep a truncated version of the newest message so the latest intent survives.
            if (selected.length === 0) {
                const truncatedMessage = truncateLocalMessageToTokenBudget(message, inputBudgetTokens);
                if (truncatedMessage) {
                    selected.push(truncatedMessage);
                    usedTokens = estimateLocalMessageTokens(truncatedMessage);
                }
            }

            break;
        }

        selected.push(message);
        usedTokens += messageTokens;
    }

    return {
        systemInstruction: normalizeSystemInstruction(config),
        messages: selected.reverse(),
        isTrimmed,
        tokenCount: usedTokens,
        inputBudgetTokens,
        maxContextMessages: safeMaxMessages
    };
}

/**
 * 构建上下文预览（用于调试和展示）
 * @param {Array} messages - 消息列表
 * @param {number} previewChars - 预览字符数（默认 80）
 * @returns {Array} 预览对象数组
 *
 * 返回格式：
 * [{ index, role, turnId, preview }]
 */
export function buildContextPreview(messages, previewChars = 80) {
    return messages.map((message, index) => {
        const rawText = typeof message?.content === 'string'
            ? message.content
            : getLocalMessageText(message, { imagePlaceholder: IMAGE_CONTEXT_PLACEHOLDER });
        const singleLine = rawText.replace(/\s+/g, ' ').trim();
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

/**
 * 构建本地消息上下文预览（别名函数）
 * @param {Array} messages - 本地消息列表
 * @param {number} previewChars - 预览字符数（默认 80）
 * @returns {Array} 预览对象数组
 */
export function buildLocalContextPreview(messages, previewChars = 80) {
    return buildContextPreview(messages, previewChars);
}
