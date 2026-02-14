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

function createSseResponse(payloads, { errorAfterChunk = 0 } = {}) {
    const encoder = new TextEncoder();
    const chunks = payloads.map((payload) => encoder.encode(payload));
    let index = 0;

    const body = new ReadableStream({
        pull(controller) {
            if (index >= chunks.length) {
                controller.close();
                return;
            }

            controller.enqueue(chunks[index]);
            index += 1;

            if (errorAfterChunk > 0 && index >= errorAfterChunk) {
                controller.error(new Error('stream broken'));
                return;
            }

            if (index >= chunks.length) {
                controller.close();
            }
        }
    });

    return new Response(body, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' }
    });
}

function toSseEvent(payload) {
    return `data: ${JSON.stringify(payload)}\n\n`;
}

function toDoneEvent() {
    return 'data: [DONE]\n\n';
}

async function collectTextDeltas(stream) {
    const deltas = [];

    for await (const event of stream) {
        if (event?.type === 'text-delta') {
            deltas.push(event.text);
        }
    }

    return deltas;
}

test('gemini provider stream parses SSE and normalizes cumulative text payloads', async () => {
    let requestBody = null;
    const finalText = `Hello${ASSISTANT_SENTENCE_MARKER}World${ASSISTANT_SEGMENT_MARKER}Again`;
    const payloads = [
        toSseEvent({ candidates: [{ content: { parts: [{ text: 'Hello' }] } }] }),
        toSseEvent({ candidates: [{ content: { parts: [{ text: `Hello${ASSISTANT_SENTENCE_MARKER}World` }] } }] }),
        toSseEvent({ candidates: [{ content: { parts: [{ text: finalText }] } }] }),
        toDoneEvent()
    ];

    const fetchMock = async (_url, options) => {
        requestBody = JSON.parse(options.body);
        return createSseResponse(payloads);
    };

    const provider = createGeminiProvider({ fetchImpl: fetchMock, maxRetries: 0 });
    const deltas = await collectTextDeltas(provider.generateStream({
        config: createGeminiConfig({ backupApiKey: '' }),
        contextMessages,
        signal: new AbortController().signal
    }));

    assert.ok(requestBody?.systemInstruction?.parts?.[0]?.text.includes(ASSISTANT_SENTENCE_MARKER));
    assert.equal(deltas.join(''), finalText);
});

test('gemini provider stream falls back to backup key before first delta', async () => {
    const apiKeys = [];
    let fallbackNoticeCount = 0;

    const fetchMock = async (_url, options) => {
        apiKeys.push(options.headers['x-goog-api-key']);

        if (apiKeys.length === 1) {
            return new Response(JSON.stringify({ error: { message: 'invalid key' } }), {
                status: 401,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        return createSseResponse([
            toSseEvent({ candidates: [{ content: { parts: [{ text: 'backup stream text' }] } }] }),
            toDoneEvent()
        ]);
    };

    const provider = createGeminiProvider({ fetchImpl: fetchMock, maxRetries: 0 });
    const deltas = await collectTextDeltas(provider.generateStream({
        config: createGeminiConfig(),
        contextMessages,
        signal: new AbortController().signal,
        onFallbackKey: () => {
            fallbackNoticeCount += 1;
        }
    }));

    assert.deepEqual(apiKeys, ['primary-key', 'backup-key']);
    assert.equal(fallbackNoticeCount, 1);
    assert.equal(deltas.join(''), 'backup stream text');
});

test('gemini provider stream does not switch backup key after first delta', async () => {
    const apiKeys = [];
    const fetchMock = async (_url, options) => {
        apiKeys.push(options.headers['x-goog-api-key']);
        const encoder = new TextEncoder();
        let pullCount = 0;
        const stream = new ReadableStream({
            pull(controller) {
                pullCount += 1;
                if (pullCount === 1) {
                    controller.enqueue(encoder.encode(
                        toSseEvent({ candidates: [{ content: { parts: [{ text: 'partial output' }] } }] })
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

    const provider = createGeminiProvider({ fetchImpl: fetchMock, maxRetries: 0 });

    await assert.rejects(
        collectTextDeltas(provider.generateStream({
            config: createGeminiConfig(),
            contextMessages,
            signal: new AbortController().signal
        })),
        /stream broken/
    );

    assert.deepEqual(apiKeys, ['primary-key']);
});

