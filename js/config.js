import { safeGetJson, safeSetJson } from './shared/safe-storage.js';

const RUNTIME_CONFIG_STORAGE_KEY = 'startpage_config';
const WEATHER_SETUP_PROMPT_FLAG_KEY = 'weather_setup_prompted_v1';

function readRuntimeConfig() {
    const globalConfig = globalThis.__STARTPAGE_CONFIG__ || {};
    const localConfig = safeGetJson(RUNTIME_CONFIG_STORAGE_KEY, {}, globalThis.localStorage);
    return { ...localConfig, ...globalConfig };
}

function asTrimmedString(value) {
    return typeof value === 'string' ? value.trim() : '';
}

export function saveRuntimeConfig(partialConfig) {
    const existingConfig = safeGetJson(RUNTIME_CONFIG_STORAGE_KEY, {}, globalThis.localStorage);
    safeSetJson(RUNTIME_CONFIG_STORAGE_KEY, { ...existingConfig, ...partialConfig }, globalThis.localStorage);
}

const runtimeConfig = readRuntimeConfig();
const weatherApiKey = asTrimmedString(runtimeConfig.weatherApiKey);
const weatherProxyUrl = asTrimmedString(runtimeConfig.weatherProxyUrl);

export function hasWeatherServiceConfig() {
    return Boolean(weatherApiKey || weatherProxyUrl);
}

export function shouldPromptWeatherSetup() {
    if (hasWeatherServiceConfig()) return false;
    if (typeof localStorage === 'undefined') return false;

    try {
        return localStorage.getItem(WEATHER_SETUP_PROMPT_FLAG_KEY) !== '1';
    } catch {
        return false;
    }
}

export function markWeatherSetupPrompted() {
    if (typeof localStorage === 'undefined') return;

    try {
        localStorage.setItem(WEATHER_SETUP_PROMPT_FLAG_KEY, '1');
    } catch {
        // Ignore write failures.
    }
}

function buildWeatherUrl(location) {
    if (weatherProxyUrl) {
        const separator = weatherProxyUrl.includes('?') ? '&' : '?';
        return `${weatherProxyUrl}${separator}location=${encodeURIComponent(location)}`;
    }

    if (!weatherApiKey) return '';

    return `https://api.seniverse.com/v3/weather/now.json?key=${encodeURIComponent(weatherApiKey)}&location=${encodeURIComponent(location)}&language=zh-Hans&unit=c`;
}

export const CONFIG = {
    WEATHER_API_KEY: weatherApiKey,
    WEATHER_PROXY_URL: weatherProxyUrl,
    WEATHER_UPDATE_INTERVAL: 30 * 60 * 1000,
    NETWORK_CHECK_INTERVAL: 10 * 1000,
    THEME_CHECK_INTERVAL: 60 * 1000,
    TIME_UPDATE_INTERVAL: 1000,
    NETWORK_TIMEOUT: 2000,
    STARS_COUNT: { small: 300, medium: 80, big: 40 }
};

export const WEATHER_API_URLS = {
    default: buildWeatherUrl('ip'),
    googleAvailable: buildWeatherUrl('WSSU6EXX52RE')
};

export const WEATHER_ICON_MAP = {
    '0': 'fa-sun',
    '1': 'fa-moon',
    '2': 'fa-sun',
    '3': 'fa-moon',
    '4': 'fa-cloud',
    '5': 'fa-cloud-sun',
    '6': 'fa-cloud-sun',
    '7': 'fa-cloud',
    '8': 'fa-cloud',
    '9': 'fa-cloud',
    '10': 'fa-cloud-showers-heavy',
    '11': 'fa-cloud-bolt',
    '12': 'fa-cloud-bolt',
    '13': 'fa-cloud-rain',
    '14': 'fa-cloud-rain',
    '15': 'fa-cloud-showers-heavy',
    '16': 'fa-wind',
    '17': 'fa-wind',
    '18': 'fa-wind',
    '19': 'fa-snowflake',
    '20': 'fa-cloud-meatball',
    '21': 'fa-snowflake',
    '22': 'fa-snowflake',
    '23': 'fa-snowflake',
    '24': 'fa-snowflake',
    '25': 'fa-snowflake',
    '26': 'fa-smog',
    '27': 'fa-smog',
    '28': 'fa-smog',
    '29': 'fa-smog',
    '30': 'fa-smog',
    '31': 'fa-smog',
    '32': 'fa-wind',
    '33': 'fa-wind',
    '34': 'fa-wind',
    '35': 'fa-wind',
    '36': 'fa-wind',
    '37': 'fa-temperature-low',
    '38': 'fa-temperature-high'
};

export const NETWORK_ENDPOINTS = {
    google: 'https://www.google.com/generate_204',
    bing: 'https://www.bing.com/generate_204'
};

export const SEARCH_ENGINES = {
    google: {
        action: 'https://www.google.com/search',
        placeholder: '使用 Google 搜索',
        statusClass: 'google-ok',
        statusText: '国际'
    },
    bing: {
        action: 'https://cn.bing.com/search',
        placeholder: '使用 Bing 搜索',
        statusClass: 'bing-ok',
        statusText: '国内'
    },
    offline: {
        action: '#',
        placeholder: '网络连接不可用',
        statusClass: 'net-fail',
        statusText: '断开'
    }
};
