/**
 * @typedef {Object} ProviderGenerateParams
 * @property {Object} config
 * @property {Array<{role: string, content: string}>} contextMessages
 * @property {AbortSignal} signal
 * @property {(attempt: number, maxRetries: number, delayMs: number) => void} [onRetryNotice]
 * @property {() => void} [onFallbackKey]
 */

/**
 * @typedef {Object} ChatProvider
 * @property {string} id
 * @property {(params: ProviderGenerateParams) => Promise<{segments: string[]}>} generate
 */

/**
 * @param {ChatProvider} provider
 * @returns {ChatProvider}
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

    return provider;
}
