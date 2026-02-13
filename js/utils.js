// DOM 元素缓存和工具函数
export const $ = (sel) => document.querySelector(sel);

export const elements = {
    timeEl: null,
    dateEl: null,
    weatherIconEl: null,
    weatherDetailsEl: null,
    searchForm: null,
    searchInput: null,
    networkIndicator: null,
    networkText: null,
    body: null
};

export function initElements() {
    elements.timeEl = $('#time');
    elements.dateEl = $('#date');
    elements.weatherIconEl = $('#weather-icon');
    elements.weatherDetailsEl = $('#weather-details');
    elements.searchForm = $('#search-form');
    elements.searchInput = $('#search-input');
    elements.networkIndicator = $('#network-indicator');
    elements.networkText = $('#network-text');
    elements.body = document.body;
}

export async function checkConnectivity(url, timeout) {
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);
        await fetch(url, { method: 'HEAD', mode: 'no-cors', signal: controller.signal });
        clearTimeout(timeoutId);
        return true;
    } catch {
        return false;
    }
}
