import { GEMINI_DEFAULTS } from './constants.js';

function parsePositiveInteger(rawValue) {
    const parsed = Number.parseInt(rawValue, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

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

function normalizeNameField(rawValue, fallback) {
    if (typeof rawValue !== 'string') {
        return fallback;
    }

    return rawValue.trim();
}

function normalizeStoredConfig(raw) {
    return {
        apiUrl: typeof raw.apiUrl === 'string' && raw.apiUrl.trim() ? raw.apiUrl.trim() : GEMINI_DEFAULTS.apiUrl,
        apiKey: typeof raw.apiKey === 'string' ? raw.apiKey.trim() : '',
        backupApiKey: typeof raw.backupApiKey === 'string' ? raw.backupApiKey.trim() : '',
        model: typeof raw.model === 'string' ? raw.model.trim() : '',
        systemPrompt: typeof raw.systemPrompt === 'string' ? raw.systemPrompt : GEMINI_DEFAULTS.systemPrompt,
        thinkingBudget: parsePositiveInteger(raw.thinkingBudget),
        searchMode: typeof raw.searchMode === 'string' ? raw.searchMode : GEMINI_DEFAULTS.searchMode,
        prefixWithTime: parseBoolean(raw.prefixWithTime, GEMINI_DEFAULTS.prefixWithTime),
        prefixWithName: parseBoolean(raw.prefixWithName, GEMINI_DEFAULTS.prefixWithName),
        userName: normalizeNameField(raw.userName, GEMINI_DEFAULTS.userName)
    };
}

export function createConfigManager(elements, storageKey) {
    const {
        cfgUrl,
        cfgKey,
        cfgBackupKey,
        cfgModel,
        cfgPrompt,
        cfgThinkingBudget,
        cfgSearchMode,
        cfgPrefixWithTime,
        cfgPrefixWithName,
        cfgUserName
    } = elements;

    function applyConfigToForm(config) {
        cfgUrl.value = config.apiUrl;
        cfgKey.value = config.apiKey;
        cfgBackupKey.value = config.backupApiKey;
        cfgModel.value = config.model;
        cfgPrompt.value = config.systemPrompt;
        cfgThinkingBudget.value = config.thinkingBudget ?? '';
        cfgPrefixWithTime.checked = config.prefixWithTime;
        cfgPrefixWithName.checked = config.prefixWithName;
        cfgUserName.value = config.userName;

        if (cfgSearchMode) {
            cfgSearchMode.value = config.searchMode;
        }
    }

    function readConfigFromForm() {
        return normalizeStoredConfig({
            apiUrl: cfgUrl.value,
            apiKey: cfgKey.value,
            backupApiKey: cfgBackupKey.value,
            model: cfgModel.value,
            systemPrompt: cfgPrompt.value,
            thinkingBudget: cfgThinkingBudget.value,
            searchMode: cfgSearchMode ? cfgSearchMode.value : GEMINI_DEFAULTS.searchMode,
            prefixWithTime: cfgPrefixWithTime.checked,
            prefixWithName: cfgPrefixWithName.checked,
            userName: cfgUserName.value
        });
    }

    function loadConfig() {
        try {
            const rawConfig = JSON.parse(localStorage.getItem(storageKey) || '{}');
            applyConfigToForm(normalizeStoredConfig(rawConfig));
        } catch {
            applyConfigToForm(normalizeStoredConfig({}));
        }
    }

    function saveConfig() {
        const config = readConfigFromForm();
        localStorage.setItem(storageKey, JSON.stringify(config));
    }

    function getConfig() {
        const config = readConfigFromForm();
        return {
            ...config,
            systemPrompt: config.systemPrompt || GEMINI_DEFAULTS.systemPrompt
        };
    }

    return {
        loadConfig,
        saveConfig,
        getConfig
    };
}
