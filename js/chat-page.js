import { initChat } from './chat.js';
import { initMobileEnhancements } from './mobile.js';

function initChatPage() {
    initChat();

    const panel = document.getElementById('chat-panel');
    if (panel) {
        panel.classList.remove('chat-hidden');
    }

    initMobileEnhancements();
}

document.addEventListener('DOMContentLoaded', initChatPage);
