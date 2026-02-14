/**
 * 聊天配置管理器
 *
 * 职责：
 * - 管理多 Provider 配置（Gemini、OpenAI、Anthropic）
 * - 同步表单字段与 localStorage 存储
 * - 处理 Provider 切换时的配置保存和恢复
 * - 规范化和验证配置参数（API URL、模型、思考预算、搜索模式等）
 * - 支持新旧配置格式的兼容（profiles vs 扁平结构）
 *
 * 依赖：constants.js, safe-storage.js
 * 被依赖：api-manager, chat.js
 */
import {
    CHAT_DEFAULTS,
    CHAT_PROVIDER_IDS,
    getProviderDefaults
} from '../constants.js';
import { safeGetJson, safeSetJson } from '../../shared/safe-storage.js';

// 支持的 Provider ID 列表
const SUPPORTED_PROVIDER_IDS = Object.values(CHAT_PROVIDER_IDS);

// OpenAI 推理级别枚举
const OPENAI_REASONING_LEVELS = new Set(['none', 'minimal', 'low', 'medium', 'high', 'xhigh']);

// 各 Provider 的搜索模式枚举
const GEMINI_SEARCH_MODES = new Set(['', 'gemini_google_search']);
const ANTHROPIC_SEARCH_MODES = new Set(['', 'anthropic_web_search']);
const OPENAI_SEARCH_MODES = new Set([
    '',
    'openai_web_search_low',
    'openai_web_search_medium',
    'openai_web_search_high'
]);

/**
 * 检查是否为 OpenAI Provider
 */
function isOpenAiProvider(provider) {
    return provider === CHAT_PROVIDER_IDS.openai
        || provider === CHAT_PROVIDER_IDS.openaiResponses;
}

/**
 * 解析正整数
 */
function parsePositiveInteger(rawValue) {
    const parsed = Number.parseInt(rawValue, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/**
 * 解析布尔值
 */
function parseBoolean(rawValue, fallback = false) {
    if (typeof rawValue === 'boolean') {
        return rawValue;
    }

    if (typeof rawValue === 'string') {
        if (rawValue === 'true') return true;
        if (rawValue === 'false') return false;
    }

    return fallback;
}

/**
 * 规范化名称字段（用户名等）
 */
function normalizeNameField(rawValue, fallback) {
    if (typeof rawValue !== 'string') {
        return fallback;
    }

    return rawValue.trim();
}

/**
 * 规范化 Provider ID
 *
 * 兼容旧的 'openai_chat_completions' 命名
 */
function normalizeProvider(rawValue) {
    const provider = typeof rawValue === 'string' ? rawValue.trim().toLowerCase() : '';

    if (provider === 'openai_chat_completions') {
        return CHAT_PROVIDER_IDS.openai;
    }

    if (SUPPORTED_PROVIDER_IDS.includes(provider)) {
        return provider;
    }

    return CHAT_DEFAULTS.provider;
}

/**
 * 规范化思考预算值
 *
 * OpenAI: 字符串枚举（'none', 'low', 'medium', 'high' 等）
 * 其他: 正整数（Token 数量）
 */
function normalizeThinkingValue(provider, rawValue) {
    if (isOpenAiProvider(provider)) {
        const normalized = typeof rawValue === 'string' ? rawValue.trim().toLowerCase() : '';
        return OPENAI_REASONING_LEVELS.has(normalized) ? normalized : null;
    }

    return parsePositiveInteger(rawValue);
}

/**
 * 规范化搜索模式
 *
 * 根据 Provider 类型验证搜索模式是否有效
 */
function normalizeSearchMode(provider, rawValue) {
    const normalized = typeof rawValue === 'string' ? rawValue.trim() : '';

    if (isOpenAiProvider(provider)) {
        return OPENAI_SEARCH_MODES.has(normalized) ? normalized : '';
    }

    if (provider === CHAT_PROVIDER_IDS.anthropic) {
        return ANTHROPIC_SEARCH_MODES.has(normalized) ? normalized : '';
    }

    return GEMINI_SEARCH_MODES.has(normalized) ? normalized : '';
}

/**
 * 规范化 Provider 配置
 *
 * @param {string} provider - Provider ID
 * @param {Object} rawProfile - 原始配置对象
 * @param {Object} fallbackProfile - 回退配置
 * @returns {Object} 规范化后的配置
 */
function normalizeProviderProfile(provider, rawProfile = {}, fallbackProfile = null) {
    const defaults = getProviderDefaults(provider);
    const fallback = fallbackProfile || defaults;

    return {
        apiUrl: typeof rawProfile.apiUrl === 'string' && rawProfile.apiUrl.trim()
            ? rawProfile.apiUrl.trim()
            : fallback.apiUrl,
        apiKey: typeof rawProfile.apiKey === 'string' ? rawProfile.apiKey.trim() : (fallback.apiKey || ''),
        backupApiKey: typeof rawProfile.backupApiKey === 'string' ? rawProfile.backupApiKey.trim() : (fallback.backupApiKey || ''),
        model: typeof rawProfile.model === 'string' ? rawProfile.model.trim() : (fallback.model || ''),
        thinkingBudget: normalizeThinkingValue(provider, rawProfile.thinkingBudget),
        searchMode: normalizeSearchMode(provider, rawProfile.searchMode)
    };
}

/**
 * 创建所有 Provider 的默认配置
 */
function createDefaultProfiles() {
    return Object.fromEntries(
        SUPPORTED_PROVIDER_IDS.map((providerId) => [
            providerId,
            normalizeProviderProfile(providerId, getProviderDefaults(providerId))
        ])
    );
}

/**
 * 克隆配置对象
 */
function cloneProfiles(profiles) {
    return Object.fromEntries(
        Object.entries(profiles).map(([providerId, profile]) => [providerId, { ...profile }])
    );
}

/**
 * 从原始配置中读取 Provider 配置
 *
 * 兼容新旧格式：
 * - 新格式：raw.profiles
 * - 旧格式：raw.providerProfiles
 */
function readRawProfiles(raw) {
    if (raw && typeof raw.profiles === 'object' && raw.profiles) {
        return raw.profiles;
    }

    if (raw && typeof raw.providerProfiles === 'object' && raw.providerProfiles) {
        return raw.providerProfiles;
    }

    return {};
}

/**
 * 规范化存储的配置
 *
 * 兼容新旧配置格式：
 * - 新格式：每个 Provider 有独立的 profile
 * - 旧格式：扁平结构，所有字段在顶层
 *
 * 迁移逻辑：
 * 1. 读取当前 Provider 和各 Provider 的配置
 * 2. 如果存在旧格式的顶层字段，合并到当前 Provider 的配置中
 * 3. 规范化所有 Provider 的配置
 * 4. 返回完整的运行时配置对象
 *
 * @param {Object} raw - 原始配置对象
 * @returns {Object} 规范化后的配置
 */
function normalizeStoredConfig(raw) {
    const provider = normalizeProvider(raw?.provider);
    const rawProfiles = readRawProfiles(raw);

    // 旧格式的顶层字段（用于向后兼容）
    const legacySource = {
        apiUrl: raw?.apiUrl,
        apiKey: raw?.apiKey,
        backupApiKey: raw?.backupApiKey,
        model: raw?.model,
        thinkingBudget: raw?.thinkingBudget,
        searchMode: raw?.searchMode
    };

    const defaultProfiles = createDefaultProfiles();
    const profiles = {};

    // 为每个 Provider 规范化配置
    SUPPORTED_PROVIDER_IDS.forEach((providerId) => {
        const rawProfile = rawProfiles?.[providerId] && typeof rawProfiles[providerId] === 'object'
            ? rawProfiles[providerId]
            : {};

        // 当前 Provider 合并旧格式字段
        const source = providerId === provider
            ? { ...legacySource, ...rawProfile }
            : rawProfile;

        profiles[providerId] = normalizeProviderProfile(providerId, source, defaultProfiles[providerId]);
    });

    const activeProfile = profiles[provider];

    return {
        provider,
        profiles,
        apiUrl: activeProfile.apiUrl,
        apiKey: activeProfile.apiKey,
        backupApiKey: activeProfile.backupApiKey,
        model: activeProfile.model,
        thinkingBudget: activeProfile.thinkingBudget,
        searchMode: activeProfile.searchMode,
        systemPrompt: typeof raw?.systemPrompt === 'string' ? raw.systemPrompt : CHAT_DEFAULTS.systemPrompt,
        enablePseudoStream: parseBoolean(raw?.enablePseudoStream, CHAT_DEFAULTS.enablePseudoStream),
        enableDraftAutosave: parseBoolean(raw?.enableDraftAutosave, CHAT_DEFAULTS.enableDraftAutosave),
        prefixWithTime: parseBoolean(raw?.prefixWithTime, CHAT_DEFAULTS.prefixWithTime),
        prefixWithName: parseBoolean(raw?.prefixWithName, CHAT_DEFAULTS.prefixWithName),
        userName: normalizeNameField(raw?.userName, CHAT_DEFAULTS.userName)
    };
}

/**
 * 格式化思考预算值为字符串（用于表单显示）
 */
function formatThinkingValue(provider, thinkingValue) {
    if (isOpenAiProvider(provider)) {
        return typeof thinkingValue === 'string' ? thinkingValue : '';
    }

    return Number.isFinite(thinkingValue) && thinkingValue > 0 ? String(thinkingValue) : '';
}

/**
 * 解析思考预算输入值
 */
function parseThinkingInput(provider, rawValue) {
    return normalizeThinkingValue(provider, rawValue);
}

/**
 * 读取搜索模式输入值
 */
function readSearchInput(provider, searchValue) {
    return normalizeSearchMode(provider, searchValue);
}

/**
 * 同步思考预算输入框类型
 *
 * OpenAI: text（字符串枚举）
 * 其他: number（整数）
 */
function syncThinkingInputType(field, provider) {
    if (!field) {
        return;
    }

    if (isOpenAiProvider(provider)) {
        field.type = 'text';
        return;
    }

    field.type = 'number';
}

/**
 * 触发元素的 change 事件
 */
function dispatchChange(element) {
    if (!element || typeof element.dispatchEvent !== 'function' || typeof Event !== 'function') {
        return;
    }

    element.dispatchEvent(new Event('change', { bubbles: true }));
}

/**
 * 创建配置管理器
 *
 * @param {Object} elements - 表单元素集合
 * @param {string} storageKey - localStorage 存储键
 * @returns {Object} 配置管理器实例
 */
export function createConfigManager(elements, storageKey) {
    const {
        cfgProvider,
        cfgUrl,
        cfgKey,
        cfgBackupKey,
        cfgModel,
        cfgPrompt,
        cfgThinkingBudget,
        cfgSearchMode,
        cfgEnablePseudoStream,
        cfgEnableDraftAutosave,
        cfgPrefixWithTime,
        cfgPrefixWithName,
        cfgUserName
    } = elements;

    let activeProvider = CHAT_DEFAULTS.provider;
    let profiles = createDefaultProfiles();

    /**
     * 从表单读取 Provider 配置
     *
     * @param {string} provider - Provider ID
     * @returns {Object} Provider 配置
     */
    function readProviderFields(provider) {
        syncThinkingInputType(cfgThinkingBudget, provider);

        return normalizeProviderProfile(provider, {
            apiUrl: cfgUrl.value,
            apiKey: cfgKey.value,
            backupApiKey: cfgBackupKey.value,
            model: cfgModel.value,
            thinkingBudget: parseThinkingInput(provider, cfgThinkingBudget.value),
            searchMode: readSearchInput(provider, cfgSearchMode ? cfgSearchMode.value : '')
        }, profiles[provider]);
    }

    /**
     * 将 Provider 配置应用到表单
     *
     * @param {string} provider - Provider ID
     * @param {Object} profile - Provider 配置
     * @param {Object} options - 选项
     * @param {boolean} options.dispatchSearchChange - 是否触发搜索模式 change 事件
     */
    function applyProviderProfile(provider, profile, { dispatchSearchChange = true } = {}) {
        cfgUrl.value = profile.apiUrl;
        cfgKey.value = profile.apiKey;
        cfgBackupKey.value = profile.backupApiKey;
        cfgModel.value = profile.model;
        syncThinkingInputType(cfgThinkingBudget, provider);
        cfgThinkingBudget.value = formatThinkingValue(provider, profile.thinkingBudget);

        if (cfgSearchMode) {
            cfgSearchMode.value = profile.searchMode;
            if (dispatchSearchChange) {
                dispatchChange(cfgSearchMode);
            }
        }
    }

    /**
     * 切换 Provider
     *
     * 在切换前保存当前 Provider 的表单值，切换后加载新 Provider 的配置
     *
     * @param {string} nextProviderRaw - 新 Provider ID
     * @param {Object} options - 选项
     * @param {boolean} options.dispatchSearchChange - 是否触发搜索模式 change 事件
     */
    function switchProvider(nextProviderRaw, { dispatchSearchChange = true } = {}) {
        const nextProvider = normalizeProvider(nextProviderRaw);
        if (nextProvider === activeProvider) {
            return;
        }

        profiles[activeProvider] = readProviderFields(activeProvider);
        activeProvider = nextProvider;
        applyProviderProfile(activeProvider, profiles[activeProvider], { dispatchSearchChange });
    }

    /**
     * 将配置应用到表单
     *
     * @param {Object} config - 完整配置对象
     */
    function applyConfigToForm(config) {
        profiles = cloneProfiles(config.profiles);
        activeProvider = config.provider;

        if (cfgProvider) {
            cfgProvider.value = config.provider;
        }

        applyProviderProfile(activeProvider, profiles[activeProvider], { dispatchSearchChange: false });
        cfgPrompt.value = config.systemPrompt;

        if (cfgEnablePseudoStream) {
            cfgEnablePseudoStream.checked = config.enablePseudoStream;
        }

        if (cfgEnableDraftAutosave) {
            cfgEnableDraftAutosave.checked = config.enableDraftAutosave;
        }

        cfgPrefixWithTime.checked = config.prefixWithTime;
        cfgPrefixWithName.checked = config.prefixWithName;
        cfgUserName.value = config.userName;

        if (cfgSearchMode) {
            dispatchChange(cfgSearchMode);
        }
    }

    /**
     * 从表单读取完整配置
     *
     * @returns {Object} 完整配置对象
     */
    function readConfigFromForm() {
        const selectedProvider = cfgProvider ? normalizeProvider(cfgProvider.value) : activeProvider;
        if (selectedProvider !== activeProvider) {
            switchProvider(selectedProvider);
        }

        profiles[activeProvider] = readProviderFields(activeProvider);
        const activeProfile = profiles[activeProvider];

        return {
            provider: activeProvider,
            profiles: cloneProfiles(profiles),
            apiUrl: activeProfile.apiUrl,
            apiKey: activeProfile.apiKey,
            backupApiKey: activeProfile.backupApiKey,
            model: activeProfile.model,
            thinkingBudget: activeProfile.thinkingBudget,
            searchMode: activeProfile.searchMode,
            systemPrompt: cfgPrompt.value,
            enablePseudoStream: cfgEnablePseudoStream ? cfgEnablePseudoStream.checked : CHAT_DEFAULTS.enablePseudoStream,
            enableDraftAutosave: cfgEnableDraftAutosave ? cfgEnableDraftAutosave.checked : CHAT_DEFAULTS.enableDraftAutosave,
            prefixWithTime: cfgPrefixWithTime.checked,
            prefixWithName: cfgPrefixWithName.checked,
            userName: cfgUserName.value
        };
    }

    /**
     * 从 localStorage 加载配置并应用到表单
     */
    function loadConfig() {
        const config = normalizeStoredConfig(
            safeGetJson(storageKey, {}, globalThis.localStorage)
        );
        applyConfigToForm(config);
    }

    /**
     * 从表单读取配置并保存到 localStorage
     */
    function saveConfig() {
        const config = normalizeStoredConfig(readConfigFromForm());
        safeSetJson(storageKey, config, globalThis.localStorage);
    }

    /**
     * 获取当前配置
     *
     * @returns {Object} 当前配置对象
     */
    function getConfig() {
        const config = normalizeStoredConfig(readConfigFromForm());
        return {
            ...config,
            systemPrompt: config.systemPrompt || CHAT_DEFAULTS.systemPrompt
        };
    }

    // 监听 Provider 选择器的 change 事件
    if (cfgProvider && typeof cfgProvider.addEventListener === 'function') {
        cfgProvider.addEventListener('change', () => {
            switchProvider(cfgProvider.value);
        });
    }

    return {
        loadConfig,
        saveConfig,
        getConfig
    };
}





