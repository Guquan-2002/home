/**
 * Provider 路由器
 *
 * 职责：
 * - 根据配置选择并路由到对应的 Provider 实现
 * - 管理多个 Provider 实例的注册和查找
 * - 提供统一的 generate 和 generateStream 接口
 * - 实现 Provider 的默认选择逻辑（优先 Gemini）
 *
 * 依赖：无
 * 被依赖：chat.js（主聊天模块）
 */

/**
 * 规范化 Provider ID（转小写并去除空格）
 * @param {*} value - 原始 Provider ID
 * @returns {string} 规范化后的 Provider ID
 */
function normalizeProviderId(value) {
    return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

/**
 * 创建 Provider 路由器
 *
 * 算法：
 * 1. 将所有 Provider 注册到 Map 中（以规范化的 ID 为键）
 * 2. 根据配置的 provider 字段查找对应的 Provider
 * 3. 如果未配置或找不到，优先使用 Gemini，否则使用第一个可用的 Provider
 *
 * @param {Array<ChatProvider>} providers - Provider 实例数组
 * @returns {Object} 路由器对象，包含 generate 和 generateStream 方法
 * @throws {Error} 如果没有提供任何 Provider
 */
export function createProviderRouter(providers = []) {
    const providerMap = new Map();

    // 注册所有有效的 Provider
    for (const provider of providers) {
        if (!provider || typeof provider.id !== 'string') {
            continue;
        }

        const providerId = normalizeProviderId(provider.id);
        if (!providerId) {
            continue;
        }

        providerMap.set(providerId, provider);
    }

    if (providerMap.size === 0) {
        throw new Error('At least one provider is required.');
    }

    /**
     * 根据配置解析对应的 Provider
     * @param {Object} config - 聊天配置对象
     * @returns {ChatProvider} 解析到的 Provider 实例
     */
    function resolveProvider(config) {
        const configuredProviderId = normalizeProviderId(config?.provider);
        if (configuredProviderId && providerMap.has(configuredProviderId)) {
            return providerMap.get(configuredProviderId);
        }

        // 默认优先使用 Gemini
        if (providerMap.has('gemini')) {
            return providerMap.get('gemini');
        }

        // 否则返回第一个可用的 Provider
        return providerMap.values().next().value;
    }

    return {
        id: 'provider-router',
        /**
         * 获取所有支持的 Provider ID 列表
         * @returns {Array<string>} Provider ID 数组
         */
        getSupportedProviderIds() {
            return Array.from(providerMap.keys());
        },
        /**
         * 非流式生成（路由到对应的 Provider）
         * @param {ProviderGenerateParams} params - 生成参数
         * @returns {Promise<{segments: string[]}>} 生成结果
         */
        async generate(params) {
            const provider = resolveProvider(params?.config);
            return provider.generate(params);
        },
        /**
         * 流式生成（路由到对应的 Provider）
         * @param {ProviderGenerateParams} params - 生成参数
         * @yields {ProviderStreamEvent} 流式事件
         * @throws {Error} 如果 Provider 不支持流式生成
         */
        async *generateStream(params) {
            const provider = resolveProvider(params?.config);
            if (typeof provider.generateStream !== 'function') {
                throw new Error(`Provider "${provider.id}" does not support streaming.`);
            }

            yield* provider.generateStream(params);
        }
    };
}
