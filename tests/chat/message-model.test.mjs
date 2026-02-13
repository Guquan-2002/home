import test from 'node:test';
import assert from 'node:assert/strict';

import {
    createChatMessage,
    createTurnId,
    normalizeChatMessage,
    splitAssistantMessageByMarker,
    stripSourcesSection
} from '../../js/chat/core/message-model.js';
import { SOURCES_MARKDOWN_MARKER } from '../../js/chat/constants.js';

test('createChatMessage creates id/turnId/meta for user message', () => {
    const turnId = createTurnId();
    const message = createChatMessage({
        role: 'user',
        content: 'Hello',
        turnId,
        metaOptions: {
            createdAt: 1700000000000,
            displayContent: '【User】\nHello',
            contextContent: '【User】\nHello'
        }
    });

    assert.equal(message.role, 'user');
    assert.equal(message.turnId, turnId);
    assert.equal(message.content, 'Hello');
    assert.ok(message.id.startsWith('msg_'));
    assert.equal(message.meta.messageId, message.id);
    assert.equal(message.meta.turnId, turnId);
    assert.equal(message.meta.createdAt, 1700000000000);
    assert.equal(message.meta.displayContent, '【User】\nHello');
});

test('normalizeChatMessage strips assistant sources section', () => {
    const rawAssistant = {
        role: 'assistant',
        content: `Answer body${SOURCES_MARKDOWN_MARKER}- source A`
    };

    const normalized = normalizeChatMessage(rawAssistant, {
        defaultTurnId: 'turn_1',
        defaultCreatedAt: 1700000000000
    });

    assert.ok(normalized);
    assert.equal(normalized.content, 'Answer body');
    assert.equal(stripSourcesSection(rawAssistant.content), 'Answer body');
});

test('normalizeChatMessage keeps legacy meta.messageId and turn fallback', () => {
    const normalized = normalizeChatMessage({
        role: 'user',
        content: 'Legacy payload',
        meta: {
            messageId: 'legacy_msg_1'
        }
    }, {
        defaultTurnId: 'turn_legacy',
        defaultCreatedAt: 1700000000000
    });

    assert.ok(normalized);
    assert.equal(normalized.id, 'legacy_msg_1');
    assert.equal(normalized.turnId, 'turn_legacy');
    assert.equal(normalized.meta.messageId, 'legacy_msg_1');
    assert.equal(normalized.meta.turnId, 'turn_legacy');
});

test('splitAssistantMessageByMarker returns trimmed segments', () => {
    const segments = splitAssistantMessageByMarker('one\n<|CHANGE_ROLE|>\n two ');
    assert.deepEqual(segments, ['one', 'two']);
});
