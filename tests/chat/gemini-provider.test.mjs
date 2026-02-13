import test from 'node:test';
import assert from 'node:assert/strict';

import { createGeminiProvider } from '../../js/chat/providers/gemini-provider.js';

function createGeminiConfig(overrides = {}) {
    return {
        provider: 'gemini',
        apiUrl: 'https://generativelanguage.googleapis.com/v1beta',
        apiKey: 'primary-key',
        backupApiKey: 'backup-key',
        model: 'gemini-2.5-pro',
        systemPrompt: 'You are a helpful assistant.',
        searchMode: '',
        thinkingBudget: null,
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
