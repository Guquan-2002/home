import test from 'node:test';
import assert from 'node:assert/strict';

import { createAnthropicProvider } from '../../js/chat/providers/vendors/anthropic-provider.js';
import { ASSISTANT_SEGMENT_MARKER, ASSISTANT_SENTENCE_MARKER } from '../../js/chat/constants.js';

function createAnthropicConfig(overrides = {}) {
    return {
        provider: 'anthropic',
        apiUrl: 'https://api.anthropic.com/v1',
        apiKey: 'primary-key',
        backupApiKey: 'backup-key',
        model: 'claude-sonnet-4-5-20250929',
        systemPrompt: 'You are a helpful assistant.',
        enablePseudoStream: true,
        ...overrides
    };
}

const contextMessages = [{ role: 'user', content: 'hello' }];

function toSseEvent(payload, eventName = 'content_block_delta') {
    return `event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`;
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

test('anthropic provider falls back to backup key when primary key fails', async () => {
    const apiKeys = [];
    const fetchMock = async (_url, options) => {
        const key = options.headers['x-api-key'] || '';
        apiKeys.push(key);

        if (apiKeys.length === 1) {
            return new Response(JSON.stringify({ error: { message: 'invalid key' } }), {
                status: 401,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        return new Response(JSON.stringify({
            content: [{ type: 'text', text: 'anthropic fallback ok' }]
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
    };

    const provider = createAnthropicProvider({ fetchImpl: fetchMock, maxRetries: 0 });
    let fallbackNoticeCount = 0;

    const result = await provider.generate({
        config: createAnthropicConfig(),
        contextMessages,
        signal: new AbortController().signal,
        onFallbackKey: () => {
            fallbackNoticeCount += 1;
        }
    });

    assert.deepEqual(apiKeys, ['primary-key', 'backup-key']);
    assert.equal(fallbackNoticeCount, 1);
    assert.deepEqual(result.segments, ['anthropic fallback ok']);
});

test('anthropic provider splits by markers when pseudo stream is enabled', async () => {
    const responseText = `A${ASSISTANT_SENTENCE_MARKER}B${ASSISTANT_SEGMENT_MARKER}C`;
    const fetchMock = async () => new Response(JSON.stringify({
        content: [{ type: 'text', text: responseText }]
    }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
    });

    const provider = createAnthropicProvider({ fetchImpl: fetchMock, maxRetries: 0 });
    const result = await provider.generate({
        config: createAnthropicConfig({ backupApiKey: '', enablePseudoStream: true }),
        contextMessages,
        signal: new AbortController().signal
    });

    assert.deepEqual(result.segments, ['A', 'B', 'C']);
});

test('anthropic provider keeps marker text when pseudo stream is disabled', async () => {
    const responseText = `A${ASSISTANT_SENTENCE_MARKER}B${ASSISTANT_SEGMENT_MARKER}C`;
    const fetchMock = async () => new Response(JSON.stringify({
        content: [{ type: 'text', text: responseText }]
    }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
    });

    const provider = createAnthropicProvider({ fetchImpl: fetchMock, maxRetries: 0 });
    const result = await provider.generate({
        config: createAnthropicConfig({ backupApiKey: '', enablePseudoStream: false }),
        contextMessages,
        signal: new AbortController().signal
    });

    assert.deepEqual(result.segments, [responseText]);
});

test('anthropic provider stream yields text deltas from SSE', async () => {
    const encoder = new TextEncoder();
    const streamBody = new ReadableStream({
        start(controller) {
            controller.enqueue(encoder.encode(
                toSseEvent({ type: 'content_block_start', content_block: { type: 'text', text: '' } }, 'content_block_start')
                + toSseEvent({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello ' } })
                + toSseEvent({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'world' } })
                + toSseEvent({ type: 'message_stop' }, 'message_stop')
            ));
            controller.close();
        }
    });

    const fetchMock = async () => new Response(streamBody, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' }
    });

    const provider = createAnthropicProvider({ fetchImpl: fetchMock, maxRetries: 0 });
    const deltas = await collectDeltas(provider.generateStream({
        config: createAnthropicConfig({ backupApiKey: '' }),
        contextMessages,
        signal: new AbortController().signal
    }));

    assert.equal(deltas.join(''), 'Hello world');
});

test('anthropic provider stream throws on SSE error event', async () => {
    const encoder = new TextEncoder();
    const streamBody = new ReadableStream({
        start(controller) {
            controller.enqueue(encoder.encode(
                toSseEvent({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello ' } })
                + toSseEvent({ type: 'error', error: { message: 'stream failed' } }, 'error')
            ));
            controller.close();
        }
    });

    const fetchMock = async () => new Response(streamBody, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' }
    });

    const provider = createAnthropicProvider({ fetchImpl: fetchMock, maxRetries: 0 });

    await assert.rejects(
        collectDeltas(provider.generateStream({
            config: createAnthropicConfig({ backupApiKey: '' }),
            contextMessages,
            signal: new AbortController().signal
        })),
        /stream failed/
    );
});

test('anthropic provider maps thinking effort and web search format', async () => {
    let requestBody = null;
    const fetchMock = async (_url, options) => {
        requestBody = JSON.parse(options.body);
        return new Response(JSON.stringify({
            content: [{ type: 'text', text: 'ok' }]
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
    };

    const provider = createAnthropicProvider({ fetchImpl: fetchMock, maxRetries: 0 });
    await provider.generate({
        config: createAnthropicConfig({
            backupApiKey: '',
            thinkingEffort: 'medium',
            searchMode: 'anthropic_web_search'
        }),
        contextMessages,
        signal: new AbortController().signal
    });

    assert.deepEqual(requestBody.thinking, {
        type: 'adaptive'
    });
    assert.deepEqual(requestBody.output_config, {
        effort: 'medium'
    });
    assert.deepEqual(requestBody.tools, [{
        type: 'web_search_20250305',
        name: 'web_search'
    }]);
    assert.equal(typeof requestBody.system, 'string');
    assert.ok(requestBody.system.includes('You are a helpful assistant.'));
    assert.equal(requestBody.messages[0].role, 'user');
    assert.deepEqual(requestBody.messages[0].content, [{
        type: 'text',
        text: 'hello'
    }]);
});

test('anthropic provider omits thinking when effort is none', async () => {
    let requestBody = null;
    const fetchMock = async (_url, options) => {
        requestBody = JSON.parse(options.body);
        return new Response(JSON.stringify({
            content: [{ type: 'text', text: 'ok' }]
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
    };

    const provider = createAnthropicProvider({ fetchImpl: fetchMock, maxRetries: 0 });
    await provider.generate({
        config: createAnthropicConfig({
            backupApiKey: '',
            thinkingEffort: 'none'
        }),
        contextMessages,
        signal: new AbortController().signal
    });

    assert.equal(requestBody.thinking, undefined);
    assert.equal(requestBody.output_config, undefined);
});

test('anthropic provider keeps non-stream request for adaptive thinking', async () => {
    const requestBodies = [];
    const fetchMock = async (_url, options) => {
        requestBodies.push(JSON.parse(options.body));
        return new Response(JSON.stringify({
            content: [{ type: 'text', text: 'non stream' }]
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
    };

    const provider = createAnthropicProvider({ fetchImpl: fetchMock, maxRetries: 0 });
    const result = await provider.generate({
        config: createAnthropicConfig({
            backupApiKey: '',
            thinkingEffort: 'high',
            maxTokens: 50000
        }),
        contextMessages,
        signal: new AbortController().signal
    });

    assert.equal(requestBodies.length, 1);
    assert.equal(requestBodies[0].stream, false);
    assert.deepEqual(result.segments, ['non stream']);
});

test('anthropic provider stream does not switch to backup key after first delta', async () => {
    const apiKeys = [];
    const fetchMock = async (_url, options) => {
        apiKeys.push(options.headers['x-api-key']);
        const encoder = new TextEncoder();
        let pullCount = 0;
        const stream = new ReadableStream({
            pull(controller) {
                pullCount += 1;
                if (pullCount === 1) {
                    controller.enqueue(encoder.encode(
                        toSseEvent({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'partial output' } })
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

    const provider = createAnthropicProvider({ fetchImpl: fetchMock, maxRetries: 0 });

    await assert.rejects(
        collectDeltas(provider.generateStream({
            config: createAnthropicConfig(),
            contextMessages,
            signal: new AbortController().signal
        })),
        /stream broken/
    );

    assert.deepEqual(apiKeys, ['primary-key']);
});

