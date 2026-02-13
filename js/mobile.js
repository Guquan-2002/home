/**
 * 移动端交互增强
 */

export function initMobileEnhancements() {
    // 检测是否为移动设备
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

    if (!isMobile && !isTouch) return;

    // 1. 处理iOS Safari视口高度问题
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
        // 输入框获得焦点时
        chatInput.addEventListener('focus', () => {
            // 延迟滚动，等待键盘弹出
            setTimeout(() => {
                if (chatMessages) {
                    chatMessages.scrollTop = chatMessages.scrollHeight;
                }
            }, 300);
        });

        // 输入框失去焦点时不强制滚动，避免页面位置跳变
    }

    // 3. 防止双击缩放
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

    // 4. 聊天面板打开时禁止背景滚动
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

    scrollableElements.forEach(el => {
        if (el) {
            el.style.webkitOverflowScrolling = 'touch';
        }
    });

    // 6. 输入框高度由 chat.js 统一管理，避免重复监听导致跳动

    // 7. 添加触觉反馈（如果支持）
    function addHapticFeedback(element) {
        if (!element) return;

        element.addEventListener('click', () => {
            if (navigator.vibrate) {
                navigator.vibrate(10); // 轻微震动10ms
            }
        });
    }

    // 为重要按钮添加触觉反馈
    const hapticButtons = [
        document.getElementById('chat-send-btn'),
        document.getElementById('chat-stop-btn'),
        document.getElementById('chat-toggle'),
        document.getElementById('cfg-save-btn')
    ];

    hapticButtons.forEach(addHapticFeedback);

    // 8. 优化代码块的横向滚动
    const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            mutation.addedNodes.forEach((node) => {
                if (node.nodeType === 1 && node.classList?.contains('chat-msg')) {
                    const preElements = node.querySelectorAll('pre');
                    preElements.forEach(pre => {
                        pre.style.webkitOverflowScrolling = 'touch';
                    });
                }
            });
        });
    });

    if (chatMessages) {
        observer.observe(chatMessages, { childList: true });
    }

    // 9. 处理横屏/竖屏切换
    function handleOrientationChange() {
        const isLandscape = window.innerWidth > window.innerHeight;
        document.body.classList.toggle('landscape', isLandscape);

        // 重新计算视口高度
        setViewportHeight();

        // 如果聊天面板打开，滚动到底部
        if (chatMessages && !chatPanel?.classList.contains('chat-hidden')) {
            setTimeout(() => {
                chatMessages.scrollTop = chatMessages.scrollHeight;
            }, 100);
        }
    }

    window.addEventListener('orientationchange', handleOrientationChange);
    window.addEventListener('resize', handleOrientationChange);

    // 10. 优化搜索输入框在移动端的行为
    const searchInput = document.getElementById('search-input');
    if (searchInput) {
        // 防止iOS Safari在输入时自动缩放
        searchInput.addEventListener('focus', (e) => {
            e.target.style.fontSize = '16px';
        });

        // 移动端回车键提交
        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                searchInput.blur(); // 收起键盘
                searchInput.form?.submit();
            }
        });
    }

    // 11. 添加移动端标识类
    document.body.classList.add('mobile-device');
    if (isTouch) {
        document.body.classList.add('touch-device');
    }

    console.log('Mobile enhancements initialized');
}
