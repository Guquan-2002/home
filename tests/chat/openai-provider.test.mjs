import test from 'node:test';
import assert from 'node:assert/strict';

import {
    createOpenAiProvider,
    createOpenAiResponsesProvider
} from '../../js/chat/providers/vendors/openai-provider.js';
import { ASSISTANT_SEGMENT_MARKER, ASSISTANT_SENTENCE_MARKER } from '../../js/chat/constants.js';

function createOpenAiConfig(overrides = {}) {
    return {
        provider: 'openai',
        apiUrl: 'https://api.openai.com/v1',
        apiKey: 'primary-key',
        backupApiKey: 'backup-key',
        model: 'gpt-4o-mini',
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

test('openai provider falls back to backup key when primary key fails', async () => {
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
            choices: [{ message: { content: 'openai fallback ok' } }]
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
    };

    const provider = createOpenAiProvider({ fetchImpl: fetchMock, maxRetries: 0 });
    let fallbackNoticeCount = 0;

    const result = await provider.generate({
        config: createOpenAiConfig(),
        contextMessages,
        signal: new AbortController().signal,
        onFallbackKey: () => {
            fallbackNoticeCount += 1;
        }
    });

    assert.deepEqual(apiKeys, ['primary-key', 'backup-key']);
    assert.equal(fallbackNoticeCount, 1);
    assert.deepEqual(result.segments, ['openai fallback ok']);
});

test('openai provider splits by markers when pseudo stream is enabled', async () => {
    const responseText = `A${ASSISTANT_SENTENCE_MARKER}B${ASSISTANT_SEGMENT_MARKER}C`;
    const fetchMock = async () => new Response(JSON.stringify({
        choices: [{ message: { content: responseText } }]
    }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
    });

    const provider = createOpenAiProvider({ fetchImpl: fetchMock, maxRetries: 0 });
    const result = await provider.generate({
        config: createOpenAiConfig({ backupApiKey: '', enablePseudoStream: true }),
        contextMessages,
        signal: new AbortController().signal
    });

    assert.deepEqual(result.segments, ['A', 'B', 'C']);
});

test('openai provider keeps marker text when pseudo stream is disabled', async () => {
    const responseText = `A${ASSISTANT_SENTENCE_MARKER}B${ASSISTANT_SEGMENT_MARKER}C`;
    const fetchMock = async () => new Response(JSON.stringify({
        choices: [{ message: { content: responseText } }]
    }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
    });

    const provider = createOpenAiProvider({ fetchImpl: fetchMock, maxRetries: 0 });
    const result = await provider.generate({
        config: createOpenAiConfig({ backupApiKey: '', enablePseudoStream: false }),
        contextMessages,
        signal: new AbortController().signal
    });

    assert.deepEqual(result.segments, [responseText]);
});

test('openai provider stream yields text deltas from SSE', async () => {
    const encoder = new TextEncoder();
    const streamBody = new ReadableStream({
        start(controller) {
            controller.enqueue(encoder.encode(
                toSseEvent({ choices: [{ delta: { content: 'Hello ' } }] })
                + toSseEvent({ choices: [{ delta: { content: 'world' } }] })
                + toDoneEvent()
            ));
            controller.close();
        }
    });

    const fetchMock = async () => new Response(streamBody, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' }
    });

    const provider = createOpenAiProvider({ fetchImpl: fetchMock, maxRetries: 0 });
    const deltas = await collectDeltas(provider.generateStream({
        config: createOpenAiConfig({ backupApiKey: '' }),
        contextMessages,
        signal: new AbortController().signal
    }));

    assert.equal(deltas.join(''), 'Hello world');
});

test('openai provider maps reasoning effort and web search format', async () => {
    let requestBody = null;
    const fetchMock = async (_url, options) => {
        requestBody = JSON.parse(options.body);
        return new Response(JSON.stringify({
            choices: [{ message: { content: 'ok' } }]
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
    };

    const provider = createOpenAiProvider({ fetchImpl: fetchMock, maxRetries: 0 });
    await provider.generate({
        config: createOpenAiConfig({
            backupApiKey: '',
            thinkingBudget: 'high',
            searchMode: 'openai_web_search_medium'
        }),
        contextMessages,
        signal: new AbortController().signal
    });

    assert.equal(requestBody.reasoning_effort, 'high');
    assert.deepEqual(requestBody.web_search_options, {
        search_context_size: 'medium'
    });
});

test('openai provider stream does not switch to backup key after first delta', async () => {
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
                        toSseEvent({ choices: [{ delta: { content: 'partial output' } }] })
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

    const provider = createOpenAiProvider({ fetchImpl: fetchMock, maxRetries: 0 });

    await assert.rejects(
        collectDeltas(provider.generateStream({
            config: createOpenAiConfig(),
            contextMessages,
            signal: new AbortController().signal
        })),
        /stream broken/
    );

    assert.deepEqual(apiKeys, ['primary-key']);
});

test('openai chat completions provider targets chat/completions endpoint', async () => {
    let requestUrl = '';
    const fetchMock = async (url) => {
        requestUrl = url;
        return new Response(JSON.stringify({
            choices: [{ message: { content: 'ok' } }]
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
    };

    const provider = createOpenAiProvider({ fetchImpl: fetchMock, maxRetries: 0 });
    await provider.generate({
        config: createOpenAiConfig({ backupApiKey: '' }),
        contextMessages,
        signal: new AbortController().signal
    });

    assert.equal(requestUrl, 'https://api.openai.com/v1/chat/completions');
});

test('openai provider supports responses API for non-stream requests', async () => {
    let requestUrl = '';
    let requestBody = null;
    const fetchMock = async (url, options) => {
        requestUrl = url;
        requestBody = JSON.parse(options.body);

        return new Response(JSON.stringify({
            output: [{
                content: [{
                    type: 'output_text',
                    text: 'responses ok'
                }]
            }]
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
    };

    const provider = createOpenAiResponsesProvider({ fetchImpl: fetchMock, maxRetries: 0 });
    const result = await provider.generate({
        config: createOpenAiConfig({ backupApiKey: '' }),
        contextMessages,
        signal: new AbortController().signal
    });

    assert.equal(requestUrl, 'https://api.openai.com/v1/responses');
    assert.deepEqual(requestBody.input, [{
        type: 'message',
        role: 'user',
        content: [{
            type: 'input_text',
            text: 'hello'
        }]
    }]);
    assert.equal(requestBody.instructions.includes('You are a helpful assistant.'), true);
    assert.deepEqual(result.segments, ['responses ok']);
});

test('openai responses request maps assistant history text to output_text', async () => {
    let requestBody = null;
    const fetchMock = async (_url, options) => {
        requestBody = JSON.parse(options.body);

        return new Response(JSON.stringify({
            output_text: 'ok'
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
    };

    const provider = createOpenAiResponsesProvider({ fetchImpl: fetchMock, maxRetries: 0 });
    await provider.generate({
        config: createOpenAiConfig({ backupApiKey: '' }),
        contextMessages: [
            { role: 'user', content: 'u1' },
            { role: 'assistant', content: 'a1' },
            { role: 'user', content: 'u2' }
        ],
        signal: new AbortController().signal
    });

    assert.deepEqual(requestBody.input, [{
        type: 'message',
        role: 'user',
        content: [{
            type: 'input_text',
            text: 'u1'
        }]
    }, {
        type: 'message',
        role: 'assistant',
        content: [{
            type: 'output_text',
            text: 'a1'
        }]
    }, {
        type: 'message',
        role: 'user',
        content: [{
            type: 'input_text',
            text: 'u2'
        }]
    }]);
});

test('openai provider supports responses API streaming deltas', async () => {
    const encoder = new TextEncoder();
    const streamBody = new ReadableStream({
        start(controller) {
            controller.enqueue(encoder.encode(
                toSseEvent({ type: 'response.output_text.delta', delta: 'Hello ' })
                + toSseEvent({ type: 'response.output_text.delta', delta: 'responses' })
                + toDoneEvent()
            ));
            controller.close();
        }
    });

    const fetchMock = async (url) => {
        assert.equal(url, 'https://api.openai.com/v1/responses');
        return new Response(streamBody, {
            status: 200,
            headers: { 'Content-Type': 'text/event-stream' }
        });
    };

    const provider = createOpenAiResponsesProvider({ fetchImpl: fetchMock, maxRetries: 0 });
    const deltas = await collectDeltas(provider.generateStream({
        config: createOpenAiConfig({ backupApiKey: '' }),
        contextMessages,
        signal: new AbortController().signal
    }));

    assert.equal(deltas.join(''), 'Hello responses');
});

test('openai responses provider appends responses path by default', async () => {
    let requestUrl = '';
    const fetchMock = async (url) => {
        requestUrl = url;
        return new Response(JSON.stringify({
            output_text: 'auto endpoint'
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
    };

    const provider = createOpenAiResponsesProvider({ fetchImpl: fetchMock, maxRetries: 0 });
    const result = await provider.generate({
        config: createOpenAiConfig({ backupApiKey: '' }),
        contextMessages,
        signal: new AbortController().signal
    });

    assert.equal(requestUrl, 'https://api.openai.com/v1/responses');
    assert.deepEqual(result.segments, ['auto endpoint']);
});

