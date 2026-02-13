import {
    WEATHER_API_URLS,
    WEATHER_ICON_MAP,
    CONFIG,
    shouldPromptWeatherSetup,
    markWeatherSetupPrompted,
    saveRuntimeConfig,
    NETWORK_ENDPOINTS
} from './config.js';
import { elements, checkConnectivity } from './utils.js';

function asTrimmedString(value) {
    return typeof value === 'string' ? value.trim() : '';
}

export function promptWeatherSetupIfNeeded() {
    if (!shouldPromptWeatherSetup()) return false;

    markWeatherSetupPrompted();

    const apiKey = window.prompt('检测到未配置天气服务，请输入心知天气 API Key：');
    const weatherApiKey = asTrimmedString(apiKey);

    if (!weatherApiKey) return false;

    saveRuntimeConfig({ weatherApiKey });
    window.alert('天气 API Key 已保存，页面即将刷新。');
    window.location.reload();
    return true;
}

export async function updateWeather(url) {
    if (!url) {
        elements.weatherIconEl.className = 'fas fa-key';
        elements.weatherDetailsEl.textContent = '未配置天气服务';
        return;
    }

    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const data = await response.json();
        if (!data.results?.[0]) throw new Error('天气数据格式错误');

        const { location, now } = data.results[0];
        elements.weatherIconEl.className = `fas ${WEATHER_ICON_MAP[now.code] || 'fa-question-circle'}`;
        elements.weatherDetailsEl.textContent = `${location.name} · ${now.text} ${now.temperature}°C`;
    } catch (error) {
        console.error('天气信息获取失败:', error);
        elements.weatherIconEl.className = 'fas fa-exclamation-triangle';
        elements.weatherDetailsEl.textContent = '天气信息加载失败';
    }
}

export async function runWeatherCheck(isGoogleAvailable) {
    elements.weatherIconEl.className = 'fas fa-spinner fa-spin';
    elements.weatherDetailsEl.textContent = '正在加载天气...';

    const apiUrl = isGoogleAvailable ? WEATHER_API_URLS.googleAvailable : WEATHER_API_URLS.default;
    await updateWeather(apiUrl);
}

export function startWeatherUpdater(interval) {
    setInterval(async () => {
        const googleOk = await checkConnectivity(NETWORK_ENDPOINTS.google, CONFIG.NETWORK_TIMEOUT);
        runWeatherCheck(googleOk);
    }, interval);
}
