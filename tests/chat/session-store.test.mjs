import test from 'node:test';
import assert from 'node:assert/strict';

import { createSessionStore } from '../../js/chat/state/session-store.js';
import { createChatMessage } from '../../js/chat/core/message-model.js';

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

function appendTurn(store, turnId, userText, assistantText = '') {
    const userMessage = createChatMessage({
        role: 'user',
        content: userText,
        turnId
    });

    const messages = [userMessage];

    if (assistantText) {
        messages.push(createChatMessage({
            role: 'assistant',
            content: assistantText,
            turnId
        }));
    }

    store.appendMessages(messages);
}

test('session store initializes with one active session', () => {
    const storage = createMemoryStorage();
    const store = createSessionStore({ storage, now: () => 1700000000000 });

    store.initialize();

    const activeSessionId = store.getActiveSessionId();
    assert.ok(activeSessionId.startsWith('session_'));
    assert.equal(store.getSortedSessions().length, 1);
    assert.equal(store.getActiveMessages().length, 0);
});

test('session store restores active session from persisted v2 history', () => {
    const storage = createMemoryStorage();
    const firstStore = createSessionStore({ storage, now: () => 1700000000000 });
    firstStore.initialize();

    const firstSessionId = firstStore.getActiveSessionId();
    appendTurn(firstStore, 'turn_restore', 'hello', 'world');

    const secondStore = createSessionStore({ storage, now: () => 1700000001000 });
    secondStore.initialize();

    assert.equal(secondStore.getActiveSessionId(), firstSessionId);
    assert.equal(secondStore.getActiveMessages().length, 2);
    assert.equal(secondStore.getActiveMessages()[0].content, 'hello');
});

test('rollbackToTurn removes target turn and all following messages', () => {
    const storage = createMemoryStorage();
    const store = createSessionStore({ storage, now: () => 1700000000000 });
    store.initialize();

    appendTurn(store, 'turn1', 'u1', 'a1');
    appendTurn(store, 'turn2', 'u2', 'a2');
    appendTurn(store, 'turn3', 'u3', 'a3');

    const rollbackResult = store.rollbackToTurn('turn2');

    assert.ok(rollbackResult);
    assert.equal(rollbackResult.retryContent, 'u2');
    assert.deepEqual(
        store.getActiveMessages().map((message) => message.content),
        ['u1', 'a1']
    );
});

test('session CRUD operations are consistent', () => {
    const storage = createMemoryStorage();
    const store = createSessionStore({ storage, now: () => 1700000000000 });
    store.initialize();

    const originalSessionId = store.getActiveSessionId();
    const newSessionId = store.createSession();

    assert.notEqual(newSessionId, originalSessionId);
    assert.equal(store.getActiveSessionId(), newSessionId);

    const renamed = store.renameSession(newSessionId, 'My Session');
    assert.equal(renamed, true);
    assert.equal(store.getSession(newSessionId).title, 'My Session');

    const deleted = store.deleteSession(newSessionId);
    assert.equal(deleted, true);
    assert.notEqual(store.getActiveSessionId(), newSessionId);

    const beforeClear = store.getSortedSessions().length;
    assert.ok(beforeClear >= 1);

    store.clearAllSessions();
    assert.equal(store.getSortedSessions().length, 1);
    assert.equal(store.getActiveMessages().length, 0);
});
