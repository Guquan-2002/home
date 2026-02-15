import test from 'node:test';
import assert from 'node:assert/strict';

import {
    buildRequestDiagnosticDetail,
    resolveConnectTimeoutMs,
    resolveContextMaxMessages,
    resolveRequestEndpoint
} from '../../js/chat/app/api-manager/diagnostics.js';

test('resolveRequestEndpoint keeps provider-specific paths', () => {
    assert.equal(
        resolveRequestEndpoint({ provider: 'openai', apiUrl: 'https://api.openai.com/v1' }, false),
        'https://api.openai.com/v1/chat/completions'
    );
    assert.equal(
        resolveRequestEndpoint({ provider: 'openai_responses', apiUrl: 'https://api.openai.com/v1/' }, true),
        'https://api.openai.com/v1/responses'
    );
    assert.equal(
        resolveRequestEndpoint({ provider: 'anthropic', apiUrl: 'https://api.anthropic.com/v1' }, false),
        'https://api.anthropic.com/v1/messages'
    );
    assert.equal(
        resolveRequestEndpoint(
            { provider: 'gemini', apiUrl: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-2.5-pro' },
            true
        ),
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:streamGenerateContent?alt=sse'
    );
});

test('buildRequestDiagnosticDetail includes endpoint/streaming/timeout/error', () => {
    const detail = buildRequestDiagnosticDetail(
        {
            provider: 'openai_responses',
            apiUrl: 'https://api.openai.com/v1',
            searchMode: 'openai_web_search'
        },
        {
            useStreaming: true,
            timeoutMs: 500,
            errorDetail: 'HTTP 400'
        }
    );

    assert.equal(detail.includes('Provider=openai_responses'), true);
    assert.equal(detail.includes('Endpoint=https://api.openai.com/v1/responses'), true);
    assert.equal(detail.includes('SearchMode=openai_web_search'), true);
    assert.equal(detail.includes('Streaming=true'), true);
    assert.equal(detail.includes('TimeoutMs=500'), true);
    assert.equal(detail.includes('Error=HTTP 400'), true);
});

test('resolveContextMaxMessages honors global override and falls back to default', () => {
    const originalGlobal = globalThis.__CHAT_CONTEXT_MAX_MESSAGES__;
    const originalStorage = globalThis.localStorage;

    try {
        globalThis.__CHAT_CONTEXT_MAX_MESSAGES__ = '42';
        globalThis.localStorage = {
            getItem() {
                return '80';
            }
        };
        assert.equal(resolveContextMaxMessages(120), 42);

        globalThis.__CHAT_CONTEXT_MAX_MESSAGES__ = undefined;
        assert.equal(resolveContextMaxMessages(120), 80);

        globalThis.localStorage = {
            getItem() {
                return null;
            }
        };
        assert.equal(resolveContextMaxMessages(120), 120);
    } finally {
        if (typeof originalGlobal === 'undefined') {
            delete globalThis.__CHAT_CONTEXT_MAX_MESSAGES__;
        } else {
            globalThis.__CHAT_CONTEXT_MAX_MESSAGES__ = originalGlobal;
        }

        if (typeof originalStorage === 'undefined') {
            delete globalThis.localStorage;
        } else {
            globalThis.localStorage = originalStorage;
        }
    }
});

test('resolveConnectTimeoutMs clamps invalid values to default', () => {
    assert.equal(resolveConnectTimeoutMs(500), 500);
    assert.equal(resolveConnectTimeoutMs(0), 30000);
    assert.equal(resolveConnectTimeoutMs(-1), 30000);
    assert.equal(resolveConnectTimeoutMs(NaN), 30000);
});

