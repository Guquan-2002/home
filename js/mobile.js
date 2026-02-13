/**
 * 移动端交互增强
 */

export function initMobileEnhancements() {
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

    if (!isMobile && !isTouch) return;

    // 1. 修复 iOS Safari 视口高度问题
    function setViewportHeight() {
        const vh = window.innerHeight * 0.01;
        document.documentElement.style.setProperty('--vh', `${vh}px`);
    }

    setViewportHeight();
    window.addEventListener('resize', setViewportHeight);
    window.addEventListener('orientationchange', () => {
        setTimeout(setViewportHeight, 100);
    });

    // 2. 聊天输入框键盘适配
    const chatInput = document.getElementById('chat-input');
    const chatPanel = document.getElementById('chat-panel');
    const chatMessages = document.getElementById('chat-messages');

    if (chatInput && chatPanel) {
        chatInput.addEventListener('focus', () => {
            setTimeout(() => {
                if (chatMessages) {
                    chatMessages.scrollTop = chatMessages.scrollHeight;
                }
            }, 300);
        });
    }

    // 3. 防止聊天区域双击缩放
    let lastTouchEnd = 0;
    document.addEventListener('touchend', (event) => {
        if (!(event.target instanceof Element)) return;
        if (!event.target.closest('#chat-panel, #chat-toggle')) return;
        if (event.target.closest('a, button, input, textarea, select, label')) return;

        const now = Date.now();
        if (now - lastTouchEnd <= 300) {
            event.preventDefault();
        }

        lastTouchEnd = now;
    }, { passive: false });

    // 4. 聊天面板打开时锁定页面滚动
    let lockedScrollY = 0;
    let isBodyScrollLocked = false;

    function lockBodyScroll() {
        if (isBodyScrollLocked) return;

        lockedScrollY = window.scrollY || window.pageYOffset || 0;
        document.body.style.overflow = 'hidden';
        document.body.style.position = 'fixed';
        document.body.style.top = `-${lockedScrollY}px`;
        document.body.style.left = '0';
        document.body.style.right = '0';
        document.body.style.width = '100%';
        isBodyScrollLocked = true;
    }

    function unlockBodyScroll() {
        if (!isBodyScrollLocked) return;

        document.body.style.overflow = '';
        document.body.style.position = '';
        document.body.style.top = '';
        document.body.style.left = '';
        document.body.style.right = '';
        document.body.style.width = '';
        window.scrollTo(0, lockedScrollY);
        isBodyScrollLocked = false;
    }

    function syncBodyScrollWithChatPanel() {
        if (!chatPanel) return;

        const isChatVisible = !chatPanel.classList.contains('chat-hidden');
        if (isChatVisible) {
            lockBodyScroll();
        } else {
            unlockBodyScroll();
        }
    }

    if (chatPanel) {
        const chatPanelObserver = new MutationObserver((mutationList) => {
            if (mutationList.some((mutation) => mutation.type === 'attributes' && mutation.attributeName === 'class')) {
                syncBodyScrollWithChatPanel();
            }
        });

        chatPanelObserver.observe(chatPanel, { attributes: true, attributeFilter: ['class'] });
        syncBodyScrollWithChatPanel();
    }

    // 5. 优化触摸滚动
    const scrollableElements = [
        document.getElementById('chat-messages'),
        document.getElementById('chat-history'),
        document.querySelector('.chat-settings-content')
    ];

    scrollableElements.forEach((el) => {
        if (el) {
            el.style.webkitOverflowScrolling = 'touch';
        }
    });

    // 6. 输入框高度由 chat.js 统一管理，避免重复监听导致跳动

    // 7. 增加触觉反馈（设备支持时）
    function addHapticFeedback(element) {
        if (!element) return;

        element.addEventListener('click', () => {
            if (navigator.vibrate) {
                navigator.vibrate(10);
            }
        });
    }

    const hapticButtons = [
        document.getElementById('chat-send-btn'),
        document.getElementById('chat-stop-btn'),
        document.getElementById('chat-toggle'),
        document.getElementById('cfg-save-btn')
    ];

    hapticButtons.forEach(addHapticFeedback);

    // 8. 优化代码块横向滚动
    const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            mutation.addedNodes.forEach((node) => {
                if (node.nodeType === 1 && node.classList?.contains('chat-msg')) {
                    const preElements = node.querySelectorAll('pre');
                    preElements.forEach((pre) => {
                        pre.style.webkitOverflowScrolling = 'touch';
                    });
                }
            });
        });
    });

    if (chatMessages) {
        observer.observe(chatMessages, { childList: true });
    }

    // 9. 横竖屏切换处理
    function handleOrientationChange() {
        const isLandscape = window.innerWidth > window.innerHeight;
        document.body.classList.toggle('landscape', isLandscape);
        setViewportHeight();

        if (chatMessages && !chatPanel?.classList.contains('chat-hidden')) {
            setTimeout(() => {
                chatMessages.scrollTop = chatMessages.scrollHeight;
            }, 100);
        }
    }

    window.addEventListener('orientationchange', handleOrientationChange);
    window.addEventListener('resize', handleOrientationChange);

    // 10. 搜索框移动端体验优化
    const searchInput = document.getElementById('search-input');
    if (searchInput) {
        searchInput.addEventListener('focus', (event) => {
            event.target.style.fontSize = '16px';
        });

        searchInput.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                searchInput.blur();
                searchInput.form?.submit();
            }
        });
    }

    // 11. 注入移动端标识类
    document.body.classList.add('mobile-device');
    if (isTouch) {
        document.body.classList.add('touch-device');
    }

    console.log('Mobile enhancements initialized');
}
