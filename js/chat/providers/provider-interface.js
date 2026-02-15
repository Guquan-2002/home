/**
 * Provider 接口定义与验证
 *
 * 职责：
 * - 定义 ChatProvider 的标准接口（TypeScript 类型定义）
 * - 提供 Provider 实例的运行时验证函数
 * - 确保所有 Provider 实现符合统一的接口规范
 *
 * 依赖：无
 * 被依赖：provider-router, anthropic-provider, gemini-provider, openai-provider
 */

/**
 * Provider 生成参数类型定义
 * @typedef {Object} ProviderGenerateParams
 * @property {Object} config - Provider 配置对象（包含 model、apiKey、apiUrl 等）
 * @property {Array<{role: string, content?: string, parts?: Array<Object>}>} contextMessages - 上下文消息数组
 * @property {{systemInstruction?: string, messages?: Array<Object>}} [localMessageEnvelope] - 本地消息封装（可选）
 * @property {AbortSignal} signal - 用于取消请求的 AbortSignal
 * @property {(attempt: number, maxRetries: number, delayMs: number) => void} [onRetryNotice] - 重试通知回调（可选）
 * @property {() => void} [onFallbackKey] - 备用密钥切换通知回调（可选）
 */

/**
 * Provider 流式事件类型定义
 * @typedef {{type: 'text-delta', text: string} | {type: 'reasoning'} | {type: 'ping'} | {type: 'fallback-key'} | {type: 'done'}} ProviderStreamEvent
 * - text-delta: 文本增量事件（包含新增的文本片段）
 * - reasoning: 推理增量事件（仅表示模型正在推理，可用于提前展示“正在输入中……”占位）
 * - ping: 非文本 SSE 事件的心跳信号（如工具调用进度），用于保持连接超时计时器重置
 * - fallback-key: 备用密钥切换事件
 * - done: 流式响应完成事件
 */

/**
 * ChatProvider 接口定义
 * @typedef {Object} ChatProvider
 * @property {string} id - Provider 唯一标识符（如 'gemini', 'openai', 'anthropic'）
 * @property {(params: ProviderGenerateParams) => Promise<{segments: string[]}>} generate - 非流式生成方法
 * @property {(params: ProviderGenerateParams) => AsyncGenerator<ProviderStreamEvent, void, void>} [generateStream] - 流式生成方法（可选）
 */

/**
 * 验证 Provider 实例是否符合接口规范
 *
 * 检查项：
 * - Provider 必须是对象
 * - 必须有非空的 id 字符串
 * - 必须实现 generate 方法
 * - 如果提供 generateStream，必须是函数
 *
 * @param {ChatProvider} provider - 待验证的 Provider 实例
 * @returns {ChatProvider} 验证通过后返回原 Provider 实例
 * @throws {Error} 验证失败时抛出错误
 */
export function assertProvider(provider) {
    if (!provider || typeof provider !== 'object') {
        throw new Error('Chat provider must be an object.');
    }

    if (typeof provider.id !== 'string' || !provider.id.trim()) {
        throw new Error('Chat provider must expose a non-empty id.');
    }

    if (typeof provider.generate !== 'function') {
        throw new Error('Chat provider must expose generate(params).');
    }

    if ('generateStream' in provider && typeof provider.generateStream !== 'function') {
        throw new Error('Chat provider generateStream must be a function when provided.');
    }

    return provider;
}
