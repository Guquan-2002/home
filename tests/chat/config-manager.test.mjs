import test from 'node:test';
import assert from 'node:assert/strict';

import { createConfigManager } from '../../js/chat/app/config-manager.js';

function createMemoryStorage() {
    const map = new Map();

    return {
        getItem(key) {
            return map.has(key) ? map.get(key) : null;
        },
        setItem(key, value) {
            map.set(key, String(value));
        },
        removeItem(key) {
            map.delete(key);
        }
    };
}

function createField(initialValue = '', {
    type = 'text',
    emulateNumberType = false
} = {}) {
    const listeners = new Map();
    let fieldType = type;
    let currentValue = String(initialValue);

    function normalizeValue(nextValue) {
        const value = String(nextValue ?? '');
        if (!emulateNumberType || fieldType !== 'number') {
            return value;
        }

        if (!value) {
            return '';
        }

        return Number.isFinite(Number(value)) ? value : '';
    }

    return {
        get value() {
            return currentValue;
        },
        set value(nextValue) {
            currentValue = normalizeValue(nextValue);
        },
        get type() {
            return fieldType;
        },
        set type(nextType) {
            fieldType = String(nextType || 'text');
            currentValue = normalizeValue(currentValue);
        },
        checked: false,
        addEventListener(eventName, handler) {
            const handlers = listeners.get(eventName) || [];
            handlers.push(handler);
            listeners.set(eventName, handlers);
        },
        removeAttribute() {},
        dispatchEvent(event) {
            const handlers = listeners.get(event?.type) || [];
            handlers.forEach((handler) => handler(event));
        }
    };
}

function createElements() {
    return {
        cfgProvider: createField('gemini'),
        cfgUrl: createField(''),
        cfgKey: createField(''),
        cfgBackupKey: createField(''),
        cfgModel: createField(''),
        cfgPrompt: createField(''),
        cfgThinkingBudget: createField('', {
            type: 'number',
            emulateNumberType: true
        }),
        cfgSearchMode: createField(''),
        cfgEnablePseudoStream: { checked: true },
        cfgEnableDraftAutosave: { checked: true },
        cfgPrefixWithTime: { checked: false },
        cfgPrefixWithName: { checked: false },
        cfgUserName: createField('User')
    };
}

test('config manager keeps provider specific credentials and models when switching', () => {
    const storage = createMemoryStorage();
    globalThis.localStorage = storage;

    const elements = createElements();
    const manager = createConfigManager(elements, 'llm_chat_config');
    manager.loadConfig();

    elements.cfgProvider.value = 'gemini';
    elements.cfgUrl.value = 'https://generativelanguage.googleapis.com/v1beta';
    elements.cfgKey.value = 'gem-key';
    elements.cfgModel.value = 'gemini-3-pro-preview';
    elements.cfgThinkingBudget.value = '2048';
    elements.cfgSearchMode.value = 'gemini_google_search';
    elements.cfgProvider.dispatchEvent(new Event('change'));

    elements.cfgProvider.value = 'openai';
    elements.cfgProvider.dispatchEvent(new Event('change'));

    assert.equal(elements.cfgUrl.value, 'https://api.openai.com/v1');
    assert.equal(elements.cfgModel.value, 'gpt-5');

    elements.cfgUrl.value = 'https://api.openai.com/v1';
    elements.cfgKey.value = 'openai-key';
    elements.cfgModel.value = 'gpt-5';
    elements.cfgThinkingBudget.value = 'medium';
    elements.cfgSearchMode.value = 'openai_web_search_high';

    elements.cfgProvider.value = 'openai_responses';
    elements.cfgProvider.dispatchEvent(new Event('change'));

    assert.equal(elements.cfgUrl.value, 'https://api.openai.com/v1');
    assert.equal(elements.cfgModel.value, 'gpt-5');

    elements.cfgUrl.value = 'https://api.openai.com/v1';
    elements.cfgKey.value = 'openai-responses-key';
    elements.cfgModel.value = 'gpt-5';
    elements.cfgThinkingBudget.value = 'high';
    elements.cfgSearchMode.value = 'openai_web_search_medium';

    elements.cfgProvider.value = 'anthropic';
    elements.cfgProvider.dispatchEvent(new Event('change'));

    assert.equal(elements.cfgUrl.value, 'https://api.anthropic.com/v1');
    assert.equal(elements.cfgModel.value, 'claude-sonnet-4-5-20250929');

    elements.cfgUrl.value = 'https://api.anthropic.com/v1';
    elements.cfgKey.value = 'anthropic-key';
    elements.cfgModel.value = 'claude-sonnet-4-5-20250929';
    elements.cfgThinkingBudget.value = '2048';
    elements.cfgSearchMode.value = 'anthropic_web_search';

    elements.cfgProvider.value = 'gemini';
    elements.cfgProvider.dispatchEvent(new Event('change'));

    assert.equal(elements.cfgKey.value, 'gem-key');
    assert.equal(elements.cfgModel.value, 'gemini-3-pro-preview');
    assert.equal(elements.cfgThinkingBudget.value, '2048');
    assert.equal(elements.cfgSearchMode.value, 'gemini_google_search');

    elements.cfgProvider.value = 'openai';
    elements.cfgProvider.dispatchEvent(new Event('change'));

    assert.equal(elements.cfgKey.value, 'openai-key');
    assert.equal(elements.cfgModel.value, 'gpt-5');
    assert.equal(elements.cfgThinkingBudget.value, 'medium');
    assert.equal(elements.cfgSearchMode.value, 'openai_web_search_high');

    elements.cfgProvider.value = 'anthropic';
    elements.cfgProvider.dispatchEvent(new Event('change'));

    assert.equal(elements.cfgKey.value, 'anthropic-key');
    assert.equal(elements.cfgModel.value, 'claude-sonnet-4-5-20250929');
    assert.equal(elements.cfgThinkingBudget.value, '2048');
    assert.equal(elements.cfgSearchMode.value, 'anthropic_web_search');

    elements.cfgProvider.value = 'openai';
    elements.cfgProvider.dispatchEvent(new Event('change'));

    assert.equal(elements.cfgKey.value, 'openai-key');
    assert.equal(elements.cfgModel.value, 'gpt-5');
    assert.equal(elements.cfgThinkingBudget.value, 'medium');
    assert.equal(elements.cfgSearchMode.value, 'openai_web_search_high');

    elements.cfgProvider.value = 'openai_responses';
    elements.cfgProvider.dispatchEvent(new Event('change'));

    assert.equal(elements.cfgKey.value, 'openai-responses-key');
    assert.equal(elements.cfgModel.value, 'gpt-5');
    assert.equal(elements.cfgThinkingBudget.value, 'high');
    assert.equal(elements.cfgSearchMode.value, 'openai_web_search_medium');

    elements.cfgProvider.value = 'anthropic';
    elements.cfgProvider.dispatchEvent(new Event('change'));

    assert.equal(elements.cfgKey.value, 'anthropic-key');
    assert.equal(elements.cfgModel.value, 'claude-sonnet-4-5-20250929');
    assert.equal(elements.cfgThinkingBudget.value, '2048');
    assert.equal(elements.cfgSearchMode.value, 'anthropic_web_search');

    manager.saveConfig();
    const saved = JSON.parse(storage.getItem('llm_chat_config'));
    assert.equal(saved.provider, 'anthropic');
    assert.equal(saved.profiles.gemini.model, 'gemini-3-pro-preview');
    assert.equal(saved.profiles.openai.model, 'gpt-5');
    assert.equal(saved.profiles.openai.thinkingBudget, 'medium');
    assert.equal(saved.profiles.openai.searchMode, 'openai_web_search_high');
    assert.equal(saved.profiles.openai_responses.model, 'gpt-5');
    assert.equal(saved.profiles.openai_responses.thinkingBudget, 'high');
    assert.equal(saved.profiles.openai_responses.searchMode, 'openai_web_search_medium');
    assert.equal(saved.profiles.anthropic.model, 'claude-sonnet-4-5-20250929');
    assert.equal(saved.profiles.anthropic.thinkingBudget, 2048);
    assert.equal(saved.profiles.anthropic.searchMode, 'anthropic_web_search');
});

