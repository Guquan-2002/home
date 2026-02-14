/**
 * 自定义下拉选择器
 *
 * 职责：
 * - 将原生 <select> 元素替换为自定义样式的下拉菜单
 * - 提供键盘导航支持（上下箭头、Enter、Escape）
 * - 支持鼠标点击和焦点管理
 * - 保持与原生 select 的同步（值变化时触发 change 事件）
 * - 提供无障碍访问支持（ARIA 属性）
 *
 * 依赖：无
 * 被依赖：chat.js（用于 Provider 选择器）
 */

/**
 * 初始化自定义下拉选择器
 *
 * 将原生 <select> 元素替换为自定义 UI，包括：
 * - 触发按钮（显示当前选中项）
 * - 下拉菜单（显示所有选项）
 * - 键盘和鼠标交互支持
 *
 * @param {HTMLSelectElement} selectEl - 原生 select 元素
 * @returns {Object|null} 控制对象 { closeMenu, syncFromSelect } 或 null
 */
export function initCustomSelect(selectEl) {
    // 防止重复初始化
    if (!selectEl || selectEl.dataset.customSelectReady === '1') {
        return null;
    }

    selectEl.dataset.customSelectReady = '1';
    selectEl.classList.add('chat-native-select-hidden');

    // 创建自定义选择器容器
    const wrapper = document.createElement('div');
    wrapper.className = 'chat-custom-select';

    // 创建触发按钮
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'chat-custom-select-trigger';
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');

    // 创建标签元素（显示当前选中项）
    const label = document.createElement('span');
    label.className = 'chat-custom-select-label';

    // 创建箭头图标
    const arrow = document.createElement('span');
    arrow.className = 'chat-custom-select-arrow';
    arrow.setAttribute('aria-hidden', 'true');

    trigger.append(label, arrow);

    // 创建下拉菜单
    const menu = document.createElement('div');
    menu.className = 'chat-custom-select-menu';
    menu.setAttribute('role', 'listbox');

    // 为每个原生 option 创建自定义选项按钮
    const options = Array.from(selectEl.options);
    for (const option of options) {
        const optionButton = document.createElement('button');
        optionButton.type = 'button';
        optionButton.className = 'chat-custom-select-option';
        optionButton.dataset.value = option.value;
        optionButton.textContent = option.textContent || '';
        optionButton.setAttribute('role', 'option');
        optionButton.disabled = option.disabled;
        menu.appendChild(optionButton);
    }

    wrapper.append(trigger, menu);
    selectEl.insertAdjacentElement('afterend', wrapper);

    const optionButtons = Array.from(menu.querySelectorAll('.chat-custom-select-option'));

    /**
     * 从原生 select 同步状态到自定义 UI
     */
    function syncFromSelect() {
        const selectedOption = selectEl.selectedOptions[0] || options[0] || null;
        label.textContent = selectedOption ? selectedOption.textContent || '' : '';

        for (const optionButton of optionButtons) {
            const isSelected = optionButton.dataset.value === selectEl.value;
            optionButton.classList.toggle('is-selected', isSelected);
            optionButton.setAttribute('aria-selected', String(isSelected));
        }
    }

    /**
     * 关闭下拉菜单
     */
    function closeMenu() {
        wrapper.classList.remove('is-open');
        trigger.setAttribute('aria-expanded', 'false');
    }

    /**
     * 打开下拉菜单
     */
    function openMenu() {
        wrapper.classList.add('is-open');
        trigger.setAttribute('aria-expanded', 'true');
    }

    /**
     * 聚焦到当前选中的选项
     */
    function focusSelectedOption() {
        const target = optionButtons.find((optionButton) => optionButton.classList.contains('is-selected')) || optionButtons[0];
        if (target) {
            target.focus();
        }
    }

    /**
     * 提交选中的值
     *
     * 更新原生 select 的值并触发 change 事件
     */
    function commitValue(value) {
        if (selectEl.value !== value) {
            selectEl.value = value;
            selectEl.dispatchEvent(new Event('change', { bubbles: true }));
        } else {
            syncFromSelect();
        }
    }

    // 触发按钮点击事件：切换菜单显示/隐藏
    trigger.addEventListener('click', (event) => {
        event.preventDefault();
        if (wrapper.classList.contains('is-open')) {
            closeMenu();
            return;
        }

        openMenu();
        focusSelectedOption();
    });

    // 触发按钮键盘事件：下箭头、Enter、空格键打开菜单
    trigger.addEventListener('keydown', (event) => {
        if (event.key !== 'ArrowDown' && event.key !== 'Enter' && event.key !== ' ') {
            return;
        }

        event.preventDefault();
        openMenu();
        focusSelectedOption();
    });

    // 菜单点击事件：选择选项
    menu.addEventListener('click', (event) => {
        const optionButton = event.target.closest('.chat-custom-select-option');
        if (!optionButton || optionButton.disabled) {
            return;
        }

        commitValue(optionButton.dataset.value || '');
        closeMenu();
        trigger.focus();
    });

    // 菜单键盘事件：上下箭头导航、Enter/空格选择、Escape 关闭
    menu.addEventListener('keydown', (event) => {
        const optionButton = event.target.closest('.chat-custom-select-option');
        if (!optionButton) {
            return;
        }

        // Escape 键关闭菜单
        if (event.key === 'Escape') {
            event.preventDefault();
            closeMenu();
            trigger.focus();
            return;
        }

        // 上下箭头导航
        const enabledButtons = optionButtons.filter((button) => !button.disabled);
        const currentIndex = enabledButtons.indexOf(optionButton);
        if (currentIndex === -1) {
            return;
        }

        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            const direction = event.key === 'ArrowDown' ? 1 : -1;
            const nextIndex = (currentIndex + direction + enabledButtons.length) % enabledButtons.length;
            enabledButtons[nextIndex].focus();
            return;
        }

        // Enter 或空格键选择选项
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            commitValue(optionButton.dataset.value || '');
            closeMenu();
            trigger.focus();
        }
    });

    // 监听原生 select 的 change 事件，同步到自定义 UI
    selectEl.addEventListener('change', syncFromSelect);

    // 点击外部区域关闭菜单
    document.addEventListener('click', (event) => {
        if (!wrapper.contains(event.target)) {
            closeMenu();
        }
    });

    // 全局 Escape 键关闭菜单
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            closeMenu();
        }
    });

    // 初始化同步
    syncFromSelect();
    return { closeMenu, syncFromSelect };
}