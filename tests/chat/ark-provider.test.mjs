import test from 'node:test';
import assert from 'node:assert/strict';

import { createArkProvider } from '../../js/chat/providers/vendors/ark-provider.js';

function createArkConfig(overrides = {}) {
    return {
        provider: 'ark_responses',
        apiUrl: 'https://ark.cn-beijing.volces.com/api/v3/responses',
        apiKey: 'primary-key',
        backupApiKey: 'backup-key',
        model: 'doubao-seed-2-0-pro-260215',
        systemPrompt: 'You are a helpful assistant.',
        enablePseudoStream: true,
        ...overrides
    };
}

const contextMessages = [{ role: 'user', content: 'hello' }];

function toSseEvent(payload) {
    return `data: ${JSON.stringify(payload)}\n\n`;
}

function toDoneEvent() {
    return 'data: [DONE]\n\n';
}

async function collectDeltas(stream) {
    const deltas = [];
    for await (const event of stream) {
        if (event?.type === 'text-delta') {
            deltas.push(event.text);
        }
    }

    return deltas;
}

test('ark provider parses non-stream response and maps thinking/web search', async () => {
    let requestBody = null;
    const fetchMock = async (_url, options) => {
        requestBody = JSON.parse(options.body);
        return new Response(JSON.stringify({
            output: [{
                content: [{
                    type: 'output_text',
                    text: 'ark non-stream ok'
                }]
            }]
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
    };

    const provider = createArkProvider({ fetchImpl: fetchMock, maxRetries: 0 });
    const result = await provider.generate({
        config: createArkConfig({
            backupApiKey: '',
            thinkingBudget: 'high',
            searchMode: 'ark_web_search'
        }),
        contextMessages,
        signal: new AbortController().signal
    });

    assert.deepEqual(requestBody.thinking, {
        type: 'enabled'
    });
    assert.deepEqual(requestBody.reasoning, {
        effort: 'high'
    });
    assert.deepEqual(requestBody.tools, [{
        type: 'web_search'
    }]);
    assert.deepEqual(result.segments, ['ark non-stream ok']);
});

test('ark provider stream yields text deltas from SSE', async () => {
    const encoder = new TextEncoder();
    const streamBody = new ReadableStream({
        start(controller) {
            controller.enqueue(encoder.encode(
                toSseEvent({ type: 'response.output_text.delta', delta: 'Hello ' })
                + toSseEvent({ type: 'response.output_text.delta', delta: 'Ark' })
                + toDoneEvent()
            ));
            controller.close();
        }
    });

    const fetchMock = async () => new Response(streamBody, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' }
    });

    const provider = createArkProvider({ fetchImpl: fetchMock, maxRetries: 0 });
    const deltas = await collectDeltas(provider.generateStream({
        config: createArkConfig({ backupApiKey: '' }),
        contextMessages,
        signal: new AbortController().signal
    }));

    assert.equal(deltas.join(''), 'Hello Ark');
});

test('ark provider falls back to backup key when primary key fails', async () => {
    const apiKeys = [];
    const fetchMock = async (_url, options) => {
        const auth = options.headers.Authorization || '';
        apiKeys.push(auth.replace('Bearer ', ''));

        if (apiKeys.length === 1) {
            return new Response(JSON.stringify({ error: { message: 'invalid key' } }), {
                status: 401,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        return new Response(JSON.stringify({
            output_text: 'ark fallback ok'
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
    };

    const provider = createArkProvider({ fetchImpl: fetchMock, maxRetries: 0 });
    let fallbackNoticeCount = 0;

    const result = await provider.generate({
        config: createArkConfig(),
        contextMessages,
        signal: new AbortController().signal,
        onFallbackKey: () => {
            fallbackNoticeCount += 1;
        }
    });

    assert.deepEqual(apiKeys, ['primary-key', 'backup-key']);
    assert.equal(fallbackNoticeCount, 1);
    assert.deepEqual(result.segments, ['ark fallback ok']);
});

test('ark provider stream does not switch to backup key after first delta', async () => {
    const apiKeys = [];
    const fetchMock = async (_url, options) => {
        const auth = options.headers.Authorization || '';
        apiKeys.push(auth.replace('Bearer ', ''));
        const encoder = new TextEncoder();
        let pullCount = 0;
        const stream = new ReadableStream({
            pull(controller) {
                pullCount += 1;
                if (pullCount === 1) {
                    controller.enqueue(encoder.encode(
                        toSseEvent({ type: 'response.output_text.delta', delta: 'partial output' })
                    ));
                    return;
                }

                controller.error(new Error('stream broken'));
            }
        });

        return new Response(stream, {
            status: 200,
            headers: { 'Content-Type': 'text/event-stream' }
        });
    };

    const provider = createArkProvider({ fetchImpl: fetchMock, maxRetries: 0 });

    await assert.rejects(
        collectDeltas(provider.generateStream({
            config: createArkConfig(),
            contextMessages,
            signal: new AbortController().signal
        })),
        /stream broken/
    );

    assert.deepEqual(apiKeys, ['primary-key']);
});
