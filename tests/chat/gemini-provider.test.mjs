import test from 'node:test';
import assert from 'node:assert/strict';

import { createGeminiProvider } from '../../js/chat/providers/vendors/gemini-provider.js';
import { ASSISTANT_SEGMENT_MARKER, ASSISTANT_SENTENCE_MARKER } from '../../js/chat/constants.js';

function createGeminiConfig(overrides = {}) {
    return {
        provider: 'gemini',
        apiUrl: 'https://generativelanguage.googleapis.com/v1beta',
        apiKey: 'primary-key',
        backupApiKey: 'backup-key',
        model: 'gemini-2.5-pro',
        systemPrompt: 'You are a helpful assistant.',
        searchMode: '',
        thinkingLevel: null,
        enablePseudoStream: true,
        ...overrides
    };
}

const contextMessages = [{ role: 'user', content: 'hello' }];

test('gemini provider falls back to backup key when primary key fails', async () => {
    const apiKeys = [];
    const fetchMock = async (_url, options) => {
        apiKeys.push(options.headers['x-goog-api-key']);

        if (apiKeys.length === 1) {
            return new Response(JSON.stringify({ error: { message: 'invalid key' } }), {
                status: 401,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        return new Response(JSON.stringify({
            candidates: [{ content: { parts: [{ text: 'fallback ok' }] } }]
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
    };

    const provider = createGeminiProvider({ fetchImpl: fetchMock, maxRetries: 0 });

    let fallbackNoticeCount = 0;
    const result = await provider.generate({
        config: createGeminiConfig(),
        contextMessages,
        signal: new AbortController().signal,
        onFallbackKey: () => {
            fallbackNoticeCount += 1;
        }
    });

    assert.deepEqual(apiKeys, ['primary-key', 'backup-key']);
    assert.equal(fallbackNoticeCount, 1);
    assert.deepEqual(result.segments, ['fallback ok']);
});

test('gemini provider retries transient fetch errors', async () => {
    let callCount = 0;
    const fetchMock = async () => {
        callCount += 1;
        if (callCount === 1) {
            throw new Error('network down');
        }

        return new Response(JSON.stringify({
            candidates: [{ content: { parts: [{ text: 'retry ok' }] } }]
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
    };

    const provider = createGeminiProvider({
        fetchImpl: fetchMock,
        maxRetries: 2,
        maxRetryDelayMs: 5
    });

    const retryNotices = [];
    const result = await provider.generate({
        config: createGeminiConfig({ backupApiKey: '' }),
        contextMessages,
        signal: new AbortController().signal,
        onRetryNotice: (attempt, maxRetries, delayMs) => {
            retryNotices.push({ attempt, maxRetries, delayMs });
        }
    });

    assert.equal(callCount, 2);
    assert.equal(retryNotices.length, 1);
    assert.equal(retryNotices[0].attempt, 1);
    assert.deepEqual(result.segments, ['retry ok']);
});

test('gemini provider injects marker rules and splits when pseudo stream is enabled', async () => {
    let requestBody = null;
    const responseText = `alpha${ASSISTANT_SENTENCE_MARKER}beta${ASSISTANT_SEGMENT_MARKER}gamma`;

    const fetchMock = async (_url, options) => {
        requestBody = JSON.parse(options.body);
        return new Response(JSON.stringify({
            candidates: [{ content: { parts: [{ text: responseText }] } }]
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
    };

    const provider = createGeminiProvider({ fetchImpl: fetchMock, maxRetries: 0 });
    const result = await provider.generate({
        config: createGeminiConfig({ enablePseudoStream: true, backupApiKey: '' }),
        contextMessages,
        signal: new AbortController().signal
    });

    assert.ok(requestBody?.systemInstruction?.parts?.[0]?.text.includes(ASSISTANT_SENTENCE_MARKER));
    assert.deepEqual(result.segments, ['alpha', 'beta', 'gamma']);
});

test('gemini provider keeps marker text untouched when pseudo stream is disabled', async () => {
    let requestBody = null;
    const responseText = `alpha${ASSISTANT_SENTENCE_MARKER}beta${ASSISTANT_SEGMENT_MARKER}gamma`;

    const fetchMock = async (_url, options) => {
        requestBody = JSON.parse(options.body);
        return new Response(JSON.stringify({
            candidates: [{ content: { parts: [{ text: responseText }] } }]
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
    };

    const provider = createGeminiProvider({ fetchImpl: fetchMock, maxRetries: 0 });
    const result = await provider.generate({
        config: createGeminiConfig({ enablePseudoStream: false, backupApiKey: '' }),
        contextMessages,
        signal: new AbortController().signal
    });

    assert.equal(
        requestBody?.systemInstruction?.parts?.[0]?.text.includes(ASSISTANT_SENTENCE_MARKER),
        false
    );
    assert.deepEqual(result.segments, [responseText]);
});

test('gemini provider respects abort signal while waiting for retry delay', async () => {
    const fetchMock = async () => new Response('server error', { status: 500 });

    const provider = createGeminiProvider({
        fetchImpl: fetchMock,
        maxRetries: 2,
        maxRetryDelayMs: 30
    });

    const controller = new AbortController();

    await assert.rejects(
        provider.generate({
            config: createGeminiConfig({ backupApiKey: '' }),
            contextMessages,
            signal: controller.signal,
            onRetryNotice: () => {
                controller.abort();
            }
        }),
        (error) => error?.name === 'AbortError'
    );
});

