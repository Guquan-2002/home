/**
 * 聊天配置管理器（重构版）
 * - 多 Provider 配置（Gemini/OpenAI/Ark/Anthropic）统一管理
 * - 与表单同步 + localStorage 持久化
 * - 兼容旧数据结构（扁平字段、旧 search/web_search_*、旧 thinkingBudget 等）
 */
import {
    CHAT_DEFAULTS,
    CHAT_PROVIDER_IDS,
    getProviderDefaults
} from '../constants.js';
import { safeGetJson, safeSetJson } from '../../shared/safe-storage.js';
import { normalizeFromUi, formatForUi } from './thinking-config.js';

// 枚举/常量
const SUPPORTED_PROVIDER_IDS = Object.values(CHAT_PROVIDER_IDS);
const OPENAI_REASONING_LEVELS = new Set(['none', 'minimal', 'low', 'medium', 'high', 'xhigh']);
const ARK_THINKING_LEVELS = new Set(['minimal', 'low', 'medium', 'high']);
const GEMINI_SEARCH_MODES = new Set(['', 'gemini_google_search']);
const ANTHROPIC_SEARCH_MODES = new Set(['', 'anthropic_web_search']);
const ARK_SEARCH_MODES = new Set(['', 'ark_web_search']);
const OPENAI_SEARCH_MODES = new Set(['', 'openai_web_search']);

// 工具函数
function isOpenAiProvider(provider) {
    return provider === CHAT_PROVIDER_IDS.openai || provider === CHAT_PROVIDER_IDS.openaiResponses;
}
function isArkProvider(provider) {
    return provider === CHAT_PROVIDER_IDS.arkResponses;
}
function isGeminiProvider(provider) {
    return provider === CHAT_PROVIDER_IDS.gemini;
}
function isAnthropicProvider(provider) {
    return provider === CHAT_PROVIDER_IDS.anthropic;
}
function parseBoolean(rawValue, fallback = false) {
    if (typeof rawValue === 'boolean') return rawValue;
    if (typeof rawValue === 'string') {
        if (rawValue === 'true') return true;
        if (rawValue === 'false') return false;
    }
    return fallback;
}
function normalizeNameField(rawValue, fallback) {
    return typeof rawValue === 'string' ? rawValue.trim() : fallback;
}
function normalizeProvider(rawValue) {
    const provider = typeof rawValue === 'string' ? rawValue.trim().toLowerCase() : '';
    if (provider === 'openai_chat_completions') return CHAT_PROVIDER_IDS.openai;
    return SUPPORTED_PROVIDER_IDS.includes(provider) ? provider : CHAT_DEFAULTS.provider;
}

// 搜索模式归一化 + 迁移 openai_web_search_* → openai_web_search
function normalizeSearchMode(provider, raw) {
    const val = typeof raw === 'string' ? raw.trim() : '';
    if (val && val.startsWith('openai_web_search_')) return 'openai_web_search';
    if (isOpenAiProvider(provider)) return OPENAI_SEARCH_MODES.has(val) ? val : '';
    if (isAnthropicProvider(provider)) return ANTHROPIC_SEARCH_MODES.has(val) ? val : '';
    if (isArkProvider(provider)) return ARK_SEARCH_MODES.has(val) ? val : '';
    return GEMINI_SEARCH_MODES.has(val) ? val : '';
}

// Thinking 值归一化（存储层面）
function normalizeGeminiThinkingLevel(rawValue) {
    if (typeof rawValue !== 'string') return null;
    const v = rawValue.trim();
    return v || null;
}
function normalizeAnthropicThinkingEffort(rawValue) {
    if (typeof rawValue !== 'string') return null;
    const v = rawValue.trim();
    return v || null;
}
function normalizeThinkingValue(provider, rawValue) {
    if (isOpenAiProvider(provider)) {
        const v = typeof rawValue === 'string' ? rawValue.trim().toLowerCase() : '';
        return OPENAI_REASONING_LEVELS.has(v) ? v : null;
    }
    if (isArkProvider(provider)) {
        const v = typeof rawValue === 'string' ? rawValue.trim().toLowerCase() : '';
        return ARK_THINKING_LEVELS.has(v) ? v : null; // Ark 不接受 none
    }
    return Number.isFinite(rawValue) && rawValue > 0 ? Number(rawValue) : null;
}

// Provider Profile 归一化 + 旧字段迁移
function normalizeProviderProfile(provider, rawProfile = {}, fallbackProfile = null) {
    const defaults = getProviderDefaults(provider);
    const fallback = fallbackProfile || defaults;
    const profile = {
        apiUrl: typeof rawProfile.apiUrl === 'string' && rawProfile.apiUrl.trim() ? rawProfile.apiUrl.trim() : fallback.apiUrl,
        apiKey: typeof rawProfile.apiKey === 'string' ? rawProfile.apiKey.trim() : (fallback.apiKey || ''),
        backupApiKey: typeof rawProfile.backupApiKey === 'string' ? rawProfile.backupApiKey.trim() : (fallback.backupApiKey || ''),
        model: typeof rawProfile.model === 'string' ? rawProfile.model.trim() : (fallback.model || ''),
        searchMode: normalizeSearchMode(provider, rawProfile.searchMode)
    };

    if (isGeminiProvider(provider)) {
        return { ...profile, thinkingLevel: normalizeGeminiThinkingLevel(rawProfile.thinkingLevel) };
    }
    if (isAnthropicProvider(provider)) {
        return { ...profile, thinkingEffort: normalizeAnthropicThinkingEffort(rawProfile.thinkingEffort) };
    }
    return { ...profile, thinkingBudget: normalizeThinkingValue(provider, rawProfile.thinkingBudget) };
}
function createDefaultProfiles() {
    return Object.fromEntries(
        SUPPORTED_PROVIDER_IDS.map((pid) => [pid, normalizeProviderProfile(pid, getProviderDefaults(pid))])
    );
}
function cloneProfiles(profiles) {
    return JSON.parse(JSON.stringify(profiles || {}));
}
function readRawProfiles(raw) {
    if (raw && typeof raw.profiles === 'object' && raw.profiles) return raw.profiles;
    return {};
}

// 顶层配置归一化（含对旧字段的兼容合并）
function normalizeStoredConfig(raw) {
    const provider = normalizeProvider(raw?.provider);
    const rawProfiles = readRawProfiles(raw);

    const legacySource = {
        apiUrl: raw?.apiUrl,
        apiKey: raw?.apiKey,
        backupApiKey: raw?.backupApiKey,
        model: raw?.model,
        thinkingLevel: raw?.thinkingLevel,
        thinkingEffort: raw?.thinkingEffort,
        thinkingBudget: raw?.thinkingBudget,
        searchMode: raw?.searchMode
    };

    const defaultProfiles = createDefaultProfiles();
    const profiles = {};

    SUPPORTED_PROVIDER_IDS.forEach((pid) => {
        const rawProfile = rawProfiles?.[pid] && typeof rawProfiles[pid] === 'object' ? rawProfiles[pid] : {};
        const source = pid === provider ? { ...legacySource, ...rawProfile } : rawProfile;
        profiles[pid] = normalizeProviderProfile(pid, source, defaultProfiles[pid]);
        // 迁移清理：
        if (pid === CHAT_PROVIDER_IDS.gemini) {
            delete profiles[pid].thinkingBudget; // 清理遗留
        }
        if (pid === CHAT_PROVIDER_IDS.anthropic) {
            delete profiles[pid].thinkingBudget; // 清理遗留
        }
    });

    const activeProfile = profiles[provider];

    return {
        provider,
        profiles,
        apiUrl: activeProfile.apiUrl,
        apiKey: activeProfile.apiKey,
        backupApiKey: activeProfile.backupApiKey,
        model: activeProfile.model,
        thinkingBudget: Object.prototype.hasOwnProperty.call(activeProfile, 'thinkingBudget') ? activeProfile.thinkingBudget : null,
        thinkingLevel: Object.prototype.hasOwnProperty.call(activeProfile, 'thinkingLevel') ? activeProfile.thinkingLevel : null,
        thinkingEffort: Object.prototype.hasOwnProperty.call(activeProfile, 'thinkingEffort') ? activeProfile.thinkingEffort : null,
        searchMode: activeProfile.searchMode,
        systemPrompt: typeof raw?.systemPrompt === 'string' ? raw.systemPrompt : CHAT_DEFAULTS.systemPrompt,
        enablePseudoStream: parseBoolean(raw?.enablePseudoStream, CHAT_DEFAULTS.enablePseudoStream),
        enableDraftAutosave: parseBoolean(raw?.enableDraftAutosave, CHAT_DEFAULTS.enableDraftAutosave),
        prefixWithTime: parseBoolean(raw?.prefixWithTime, CHAT_DEFAULTS.prefixWithTime),
        prefixWithName: parseBoolean(raw?.prefixWithName, CHAT_DEFAULTS.prefixWithName),
        userName: normalizeNameField(raw?.userName, CHAT_DEFAULTS.userName)
    };
}

// 导出：创建配置管理器
export function createConfigManager(elements, storageKey) {
    const {
        cfgProvider,
        cfgUrl,
        cfgKey,
        cfgBackupKey,
        cfgModel,
        cfgPrompt,
        cfgThinkingLevel,
        cfgSearchMode,
        cfgEnablePseudoStream,
        cfgEnableDraftAutosave,
        cfgPrefixWithTime,
        cfgPrefixWithName,
        cfgUserName
    } = elements;

    let activeProvider = CHAT_DEFAULTS.provider;
    let profiles = createDefaultProfiles();

    function readProviderFields(provider) {
        const normalized = normalizeFromUi(provider, cfgThinkingLevel ? cfgThinkingLevel.value : '');
        const thinkingFields = normalized && normalized.field ? { [normalized.field]: normalized.value } : {};
        return normalizeProviderProfile(provider, {
            apiUrl: cfgUrl.value,
            apiKey: cfgKey.value,
            backupApiKey: cfgBackupKey.value,
            model: cfgModel.value,
            ...thinkingFields,
            searchMode: normalizeSearchMode(provider, cfgSearchMode ? cfgSearchMode.value : '')
        }, profiles[provider]);
    }

    function applyProviderProfile(provider, profile, { dispatchSearchChange = true } = {}) {
        cfgUrl.value = profile.apiUrl;
        cfgKey.value = profile.apiKey;
        cfgBackupKey.value = profile.backupApiKey;
        cfgModel.value = profile.model;
        if (cfgThinkingLevel) {
            cfgThinkingLevel.value = formatForUi(provider, profile);
        }
        if (cfgSearchMode) {
            cfgSearchMode.value = profile.searchMode;
            if (dispatchSearchChange) {
                cfgSearchMode.dispatchEvent?.(new Event('change', { bubbles: true }));
            }
        }
    }

    function switchProvider(nextProviderRaw, { dispatchSearchChange = true } = {}) {
        const nextProvider = normalizeProvider(nextProviderRaw);
        if (nextProvider === activeProvider) return;
        profiles[activeProvider] = readProviderFields(activeProvider);
        activeProvider = nextProvider;
        applyProviderProfile(activeProvider, profiles[activeProvider], { dispatchSearchChange });
    }

    function applyConfigToForm(config) {
        profiles = cloneProfiles(config.profiles);
        activeProvider = config.provider;
        if (cfgProvider) cfgProvider.value = config.provider;
        applyProviderProfile(activeProvider, profiles[activeProvider], { dispatchSearchChange: false });
        cfgPrompt.value = config.systemPrompt;
        if (cfgEnablePseudoStream) cfgEnablePseudoStream.checked = config.enablePseudoStream;
        if (cfgEnableDraftAutosave) cfgEnableDraftAutosave.checked = config.enableDraftAutosave;
        cfgPrefixWithTime.checked = config.prefixWithTime;
        cfgPrefixWithName.checked = config.prefixWithName;
        cfgUserName.value = config.userName;
        if (cfgSearchMode) cfgSearchMode.dispatchEvent?.(new Event('change', { bubbles: true }));
    }

    function readConfigFromForm() {
        const selectedProvider = cfgProvider ? normalizeProvider(cfgProvider.value) : activeProvider;
        if (selectedProvider !== activeProvider) switchProvider(selectedProvider);
        profiles[activeProvider] = readProviderFields(activeProvider);
        const activeProfile = profiles[activeProvider];
        return {
            provider: activeProvider,
            profiles: cloneProfiles(profiles),
            apiUrl: activeProfile.apiUrl,
            apiKey: activeProfile.apiKey,
            backupApiKey: activeProfile.backupApiKey,
            model: activeProfile.model,
            thinkingBudget: Object.prototype.hasOwnProperty.call(activeProfile, 'thinkingBudget') ? activeProfile.thinkingBudget : null,
            thinkingLevel: Object.prototype.hasOwnProperty.call(activeProfile, 'thinkingLevel') ? activeProfile.thinkingLevel : null,
            thinkingEffort: Object.prototype.hasOwnProperty.call(activeProfile, 'thinkingEffort') ? activeProfile.thinkingEffort : null,
            searchMode: activeProfile.searchMode,
            systemPrompt: cfgPrompt.value,
            enablePseudoStream: cfgEnablePseudoStream ? cfgEnablePseudoStream.checked : CHAT_DEFAULTS.enablePseudoStream,
            enableDraftAutosave: cfgEnableDraftAutosave ? cfgEnableDraftAutosave.checked : CHAT_DEFAULTS.enableDraftAutosave,
            prefixWithTime: cfgPrefixWithTime.checked,
            prefixWithName: cfgPrefixWithName.checked,
            userName: cfgUserName.value
        };
    }

    function loadConfig() {
        const config = normalizeStoredConfig(safeGetJson(storageKey, {}, globalThis.localStorage));
        applyConfigToForm(config);
    }

    function saveConfig() {
        const config = normalizeStoredConfig(readConfigFromForm());
        safeSetJson(storageKey, config, globalThis.localStorage);
    }

    function getConfig() {
        const config = normalizeStoredConfig(readConfigFromForm());
        return { ...config, systemPrompt: config.systemPrompt || CHAT_DEFAULTS.systemPrompt };
    }

    if (cfgProvider && typeof cfgProvider.addEventListener === 'function') {
        cfgProvider.addEventListener('change', () => switchProvider(cfgProvider.value));
    }

    return { loadConfig, saveConfig, getConfig };
}
