/**
 * Custom select component for chat settings.
 * - Hides native <select> and renders accessible custom UI
 * - Keyboard + mouse support, ARIA attributes
 * - Keeps in sync with the underlying <select>
 * - Supports rebuilding options when the underlying <select> options change
 */

/**
 * Initialize a custom select for the given native <select> element.
 * Returns a small API { closeMenu, syncFromSelect, rebuildOptions } or null.
 */
export function initCustomSelect(selectEl) {
    if (!selectEl) return null;
    if (selectEl.dataset.customSelectReady === '1' && selectEl._customSelectApi) {
        return selectEl._customSelectApi;
    }

    selectEl.dataset.customSelectReady = '1';
    selectEl.classList.add('chat-native-select-hidden');

    const wrapper = document.createElement('div');
    wrapper.className = 'chat-custom-select';

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'chat-custom-select-trigger';
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');

    const label = document.createElement('span');
    label.className = 'chat-custom-select-label';

    const arrow = document.createElement('span');
    arrow.className = 'chat-custom-select-arrow';
    arrow.setAttribute('aria-hidden', 'true');

    trigger.append(label, arrow);

    const menu = document.createElement('div');
    menu.className = 'chat-custom-select-menu';
    menu.setAttribute('role', 'listbox');

    wrapper.append(trigger, menu);
    selectEl.insertAdjacentElement('afterend', wrapper);

    let optionButtons = [];

    function buildOptionButton(option) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'chat-custom-select-option';
        btn.dataset.value = option.value;
        btn.textContent = option.textContent || '';
        btn.setAttribute('role', 'option');
        btn.disabled = option.disabled;
        return btn;
    }

    function rebuildOptions() {
        // Clear menu
        while (menu.firstChild) menu.removeChild(menu.firstChild);
        // Re-add buttons
        const opts = Array.from(selectEl.options);
        for (const opt of opts) {
            menu.appendChild(buildOptionButton(opt));
        }
        optionButtons = Array.from(menu.querySelectorAll('.chat-custom-select-option'));
        syncFromSelect();
    }

    function syncFromSelect() {
        const options = Array.from(selectEl.options);
        const selectedOption = selectEl.selectedOptions[0] || options[0] || null;
        label.textContent = selectedOption ? (selectedOption.textContent || '') : '';
        for (const optionButton of optionButtons) {
            const isSelected = optionButton.dataset.value === selectEl.value;
            optionButton.classList.toggle('is-selected', isSelected);
            optionButton.setAttribute('aria-selected', String(isSelected));
        }
    }

    function closeMenu() {
        wrapper.classList.remove('is-open');
        trigger.setAttribute('aria-expanded', 'false');
    }

    function openMenu() {
        wrapper.classList.add('is-open');
        trigger.setAttribute('aria-expanded', 'true');
    }

    function focusSelectedOption() {
        const target = optionButtons.find((b) => b.classList.contains('is-selected')) || optionButtons[0];
        if (target) target.focus();
    }

    function commitValue(value) {
        if (selectEl.value !== value) {
            selectEl.value = value;
            selectEl.dispatchEvent(new Event('change', { bubbles: true }));
        } else {
            syncFromSelect();
        }
    }

    // Event wiring
    trigger.addEventListener('click', (event) => {
        event.preventDefault();
        if (wrapper.classList.contains('is-open')) { closeMenu(); return; }
        openMenu();
        focusSelectedOption();
    });

    trigger.addEventListener('keydown', (event) => {
        if (event.key !== 'ArrowDown' && event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        openMenu();
        focusSelectedOption();
    });

    menu.addEventListener('click', (event) => {
        const optionButton = event.target.closest('.chat-custom-select-option');
        if (!optionButton || optionButton.disabled) return;
        commitValue(optionButton.dataset.value || '');
        closeMenu();
        trigger.focus();
    });

    menu.addEventListener('keydown', (event) => {
        const optionButton = event.target.closest('.chat-custom-select-option');
        if (!optionButton) return;
        if (event.key === 'Escape') { event.preventDefault(); closeMenu(); trigger.focus(); return; }
        const enabledButtons = optionButtons.filter((b) => !b.disabled);
        const currentIndex = enabledButtons.indexOf(optionButton);
        if (currentIndex === -1) return;
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            const direction = event.key === 'ArrowDown' ? 1 : -1;
            const nextIndex = (currentIndex + direction + enabledButtons.length) % enabledButtons.length;
            enabledButtons[nextIndex].focus();
            return;
        }
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            commitValue(optionButton.dataset.value || '');
            closeMenu();
            trigger.focus();
        }
    });

    selectEl.addEventListener('change', syncFromSelect);
    document.addEventListener('click', (event) => { if (!wrapper.contains(event.target)) closeMenu(); });
    document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeMenu(); });

    // Initial build
    rebuildOptions();

    const api = { closeMenu, syncFromSelect, rebuildOptions };
    selectEl._customSelectApi = api;
    return api;
}

/**
 * Refresh a custom select after changing native <select> options.
 * If the select was not initialized yet, initialize it.
 */
export function refreshCustomSelect(selectEl) {
    if (!selectEl) return false;
    if (selectEl._customSelectApi && typeof selectEl._customSelectApi.rebuildOptions === 'function') {
        selectEl._customSelectApi.rebuildOptions();
        return true;
    }
    return !!initCustomSelect(selectEl);
}
