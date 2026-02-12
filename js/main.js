import { CONFIG } from './config.js';
import { initElements } from './utils.js';
import { startTimeClock } from './time.js';
import { startThemeUpdater } from './theme.js';
import { promptWeatherSetupIfNeeded, runWeatherCheck, startWeatherUpdater } from './weather.js';
import { runNetworkCheck, startNetworkMonitor } from './network.js';
import { generateStars } from './starfield.js';
import { initChat } from './chat.js';
import { initMobileEnhancements } from './mobile.js';

async function init() {
    initElements();
    startTimeClock(CONFIG.TIME_UPDATE_INTERVAL);
    startThemeUpdater(CONFIG.THEME_CHECK_INTERVAL);
    generateStars();

    if (promptWeatherSetupIfNeeded()) return;

    const isGoogleAvailable = await runNetworkCheck();
    runWeatherCheck(isGoogleAvailable);

    startNetworkMonitor(CONFIG.NETWORK_CHECK_INTERVAL);
    startWeatherUpdater(CONFIG.WEATHER_UPDATE_INTERVAL);

    initChat();
    initMobileEnhancements();
}

document.addEventListener('DOMContentLoaded', init);
