/**
 * 系统指令构建器
 *
 * 职责：
 * - 构建完整的系统指令（包含用户自定义提示词和标记分割规则）
 * - 根据是否启用标记分割，动态注入格式化规则
 * - 确保系统指令的正确拼接和格式化
 *
 * 依赖：constants.js（标记符常量）
 * 被依赖：anthropic-provider, gemini-provider, openai-provider
 */
import { ASSISTANT_SEGMENT_MARKER, ASSISTANT_SENTENCE_MARKER } from '../constants.js';

/**
 * 构建标记分割指令
 *
 * 如果启用标记分割，返回格式化规则说明，指导 AI 在响应中插入标记符
 *
 * @param {boolean} enableMarkerSplit - 是否启用标记分割
 * @returns {string} 标记分割指令文本（未启用时返回空字符串）
 */
function buildMarkerInstruction(enableMarkerSplit) {
    if (!enableMarkerSplit) {
        return '';
    }

    return [
        '格式规则：',
        `- 当您需要在角色间切换时，使用标记令牌 ${ASSISTANT_SEGMENT_MARKER} 分割输出。`,
        `- 在每个完整句子之后，使用标记令牌 ${ASSISTANT_SENTENCE_MARKER} 分割输出。`,
        '- 不要在代码块、表格、URL、行内代码中输出标记令牌。',
        '- 仅在角色切换或完整句子结束时输出标记令牌。',
        '- 在输出标记令牌时，前后不要输出标点符号（如句号、逗号、感叹号等）。',
    ].join('\n');
}

/**
 * 构建完整的系统指令
 *
 * 算法：
 * 1. 提取配置中的基础提示词
 * 2. 根据 enableMarkerSplit 生成标记分割指令
 * 3. 拼接两部分（如果都存在，用双换行分隔）
 *
 * @param {Object} config - Provider 配置对象
 * @param {boolean} enableMarkerSplit - 是否启用标记分割
 * @returns {string} 完整的系统指令文本
 */
export function buildSystemInstruction(config, enableMarkerSplit) {
    const basePrompt = typeof config?.systemPrompt === 'string'
        ? config.systemPrompt.trim()
        : '';
    const markerInstruction = buildMarkerInstruction(enableMarkerSplit);

    if (!basePrompt) {
        return markerInstruction;
    }

    if (!markerInstruction) {
        return basePrompt;
    }

    return `${basePrompt}\n\n${markerInstruction}`;
}
