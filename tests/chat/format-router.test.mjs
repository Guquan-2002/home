import test from 'node:test';
import assert from 'node:assert/strict';

import { CHAT_PROVIDER_IDS } from '../../js/chat/constants.js';
import { buildProviderRequest } from '../../js/chat/providers/format-router.js';

function createBaseConfig(overrides = {}) {
    return {
        provider: CHAT_PROVIDER_IDS.gemini,
        apiUrl: 'https://example.com/v1',
        model: 'model-test',
        thinkingBudget: null,
        thinkingLevel: null,
        thinkingEffort: null,
        searchMode: '',
        ...overrides
    };
}

test('format router builds OpenAI chat completions request for text+image message', () => {
    const request = buildProviderRequest({
        providerId: CHAT_PROVIDER_IDS.openai,
        config: createBaseConfig({
            provider: CHAT_PROVIDER_IDS.openai,
            apiUrl: 'https://api.openai.com/v1',
            model: 'gpt-4o-mini',
            thinkingBudget: 'high',
            searchMode: 'openai_web_search_medium'
        }),
        envelope: {
            systemInstruction: 'You are helpful.',
            messages: [{
                role: 'user',
                parts: [
                    { type: 'text', text: 'describe this image' },
                    {
                        type: 'image',
                        image: {
                            sourceType: 'url',
                            value: 'https://example.com/dog.png',
                            detail: 'low'
                        }
                    }
                ]
            }]
        },
        stream: false,
        apiKey: 'sk-test'
    });

    assert.equal(request.endpoint, 'https://api.openai.com/v1/chat/completions');
    assert.equal(request.headers.Authorization, 'Bearer sk-test');
    assert.equal(request.body.reasoning_effort, 'high');
    assert.deepEqual(request.body.web_search_options, { search_context_size: 'medium' });
    assert.equal(request.body.messages[0].role, 'system');
    assert.deepEqual(request.body.messages[1].content, [
        { type: 'text', text: 'describe this image' },
        {
            type: 'image_url',
            image_url: {
                url: 'https://example.com/dog.png',
                detail: 'low'
            }
        }
    ]);
});

test('format router builds OpenAI responses request with input_text + input_image(file_id)', () => {
    const request = buildProviderRequest({
        providerId: CHAT_PROVIDER_IDS.openaiResponses,
        config: createBaseConfig({
            provider: CHAT_PROVIDER_IDS.openaiResponses,
            apiUrl: 'https://api.openai.com/v1',
            model: 'gpt-4o-mini'
        }),
        envelope: {
            systemInstruction: 'System prompt',
            messages: [{
                role: 'user',
                parts: [
                    { type: 'text', text: 'read this file image' },
                    {
                        type: 'image',
                        image: {
                            sourceType: 'file_id',
                            value: 'file-abc'
                        }
                    }
                ]
            }]
        },
        stream: true,
        apiKey: 'sk-test'
    });

    assert.equal(request.endpoint, 'https://api.openai.com/v1/responses');
    assert.equal(request.body.stream, true);
    assert.equal(request.body.instructions, 'System prompt');
    assert.deepEqual(request.body.input[0], {
        type: 'message',
        role: 'user',
        content: [
            { type: 'input_text', text: 'read this file image' },
            { type: 'input_image', file_id: 'file-abc' }
        ]
    });
});

test('format router maps OpenAI responses assistant history text to output_text', () => {
    const request = buildProviderRequest({
        providerId: CHAT_PROVIDER_IDS.openaiResponses,
        config: createBaseConfig({
            provider: CHAT_PROVIDER_IDS.openaiResponses,
            apiUrl: 'https://api.openai.com/v1',
            model: 'gpt-4o-mini'
        }),
        envelope: {
            messages: [
                {
                    role: 'user',
                    parts: [{ type: 'text', text: 'u1' }]
                },
                {
                    role: 'assistant',
                    parts: [{ type: 'text', text: 'a1' }]
                },
                {
                    role: 'user',
                    parts: [{ type: 'text', text: 'u2' }]
                }
            ]
        },
        stream: false,
        apiKey: 'sk-test'
    });

    assert.deepEqual(request.body.input, [
        {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: 'u1' }]
        },
        {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'a1' }]
        },
        {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: 'u2' }]
        }
    ]);
});

test('format router throws when OpenAI responses assistant history includes image', () => {
    assert.throws(() => buildProviderRequest({
        providerId: CHAT_PROVIDER_IDS.openaiResponses,
        config: createBaseConfig({
            provider: CHAT_PROVIDER_IDS.openaiResponses,
            apiUrl: 'https://api.openai.com/v1',
            model: 'gpt-4o-mini'
        }),
        envelope: {
            messages: [{
                role: 'assistant',
                parts: [{
                    type: 'image',
                    image: {
                        sourceType: 'url',
                        value: 'https://example.com/a.png'
                    }
                }]
            }]
        },
        stream: false,
        apiKey: 'sk-test'
    }), /assistant message does not support image parts/);
});

test('format router builds Ark responses request with thinking + web search', () => {
    const request = buildProviderRequest({
        providerId: CHAT_PROVIDER_IDS.arkResponses,
        config: createBaseConfig({
            provider: CHAT_PROVIDER_IDS.arkResponses,
            apiUrl: 'https://ark.cn-beijing.volces.com/api/v3/responses',
            model: 'doubao-seed-2-0-pro-260215',
            thinkingBudget: 'medium',
            searchMode: 'ark_web_search'
        }),
        envelope: {
            systemInstruction: 'Ark system',
            messages: [{
                role: 'user',
                parts: [
                    { type: 'text', text: 'summarize this image' },
                    {
                        type: 'image',
                        image: {
                            sourceType: 'file_id',
                            value: 'file-ark-1'
                        }
                    }
                ]
            }]
        },
        stream: false,
        apiKey: 'ark-key'
    });

    assert.equal(request.endpoint, 'https://ark.cn-beijing.volces.com/api/v3/responses');
    assert.equal(request.headers.Authorization, 'Bearer ark-key');
    assert.deepEqual(request.body.thinking, {
        type: 'enabled'
    });
    assert.deepEqual(request.body.reasoning, {
        effort: 'medium'
    });
    assert.deepEqual(request.body.tools, [{
        type: 'web_search'
    }]);
    assert.deepEqual(request.body.input[0], {
        type: 'message',
        role: 'user',
        content: [
            { type: 'input_text', text: 'summarize this image' },
            { type: 'input_image', file_id: 'file-ark-1' }
        ]
    });
});

test('format router builds Anthropic request with top-level system and base64 image source', () => {
    const request = buildProviderRequest({
        providerId: CHAT_PROVIDER_IDS.anthropic,
        config: createBaseConfig({
            provider: CHAT_PROVIDER_IDS.anthropic,
            apiUrl: 'https://api.anthropic.com/v1',
            model: 'claude-sonnet-4-5-20250929',
            thinkingEffort: 'medium',
            searchMode: 'anthropic_web_search'
        }),
        envelope: {
            systemInstruction: 'Anthropic system',
            messages: [{
                role: 'user',
                parts: [{
                    type: 'image',
                    image: {
                        sourceType: 'data_url',
                        value: 'data:image/png;base64,aGVsbG8='
                    }
                }]
            }]
        },
        stream: false,
        apiKey: 'sk-ant-test'
    });

    assert.equal(request.endpoint, 'https://api.anthropic.com/v1/messages');
    assert.equal(request.headers['x-api-key'], 'sk-ant-test');
    assert.equal(request.body.system, 'Anthropic system');
    assert.deepEqual(request.body.thinking, {
        type: 'adaptive'
    });
    assert.deepEqual(request.body.output_config, {
        effort: 'medium'
    });
    assert.deepEqual(request.body.tools, [{
        type: 'web_search_20250305',
        name: 'web_search'
    }]);
    assert.deepEqual(request.body.messages[0].content[0], {
        type: 'image',
        source: {
            type: 'base64',
            media_type: 'image/png',
            data: 'aGVsbG8='
        }
    });
});

test('format router omits Anthropic thinking when effort is none', () => {
    const request = buildProviderRequest({
        providerId: CHAT_PROVIDER_IDS.anthropic,
        config: createBaseConfig({
            provider: CHAT_PROVIDER_IDS.anthropic,
            apiUrl: 'https://api.anthropic.com/v1',
            model: 'claude-sonnet-4-5-20250929',
            thinkingEffort: 'none'
        }),
        envelope: {
            messages: [{
                role: 'user',
                parts: [{ type: 'text', text: 'hello' }]
            }]
        },
        stream: false,
        apiKey: 'sk-ant-test'
    });

    assert.equal(request.body.thinking, undefined);
    assert.equal(request.body.output_config, undefined);
});

test('format router builds Gemini request with inline_data and file_data parts', () => {
    const request = buildProviderRequest({
        providerId: CHAT_PROVIDER_IDS.gemini,
        config: createBaseConfig({
            provider: CHAT_PROVIDER_IDS.gemini,
            apiUrl: 'https://generativelanguage.googleapis.com/v1beta',
            model: 'gemini-2.5-pro',
            searchMode: 'gemini_google_search',
            thinkingLevel: 'high'
        }),
        envelope: {
            systemInstruction: 'Gemini system',
            messages: [{
                role: 'user',
                parts: [
                    { type: 'text', text: 'first image from base64' },
                    {
                        type: 'image',
                        image: {
                            sourceType: 'base64',
                            mimeType: 'image/jpeg',
                            value: 'YmFzZTY0'
                        }
                    },
                    {
                        type: 'image',
                        image: {
                            sourceType: 'file_uri',
                            value: 'gs://bucket/image.png',
                            mimeType: 'image/png'
                        }
                    }
                ]
            }]
        },
        stream: true,
        apiKey: 'AIza-test'
    });

    assert.equal(
        request.endpoint,
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:streamGenerateContent?alt=sse'
    );
    assert.equal(request.headers['x-goog-api-key'], 'AIza-test');
    assert.equal(request.body.systemInstruction.parts[0].text, 'Gemini system');
    assert.deepEqual(request.body.tools, [{ google_search: {} }]);
    assert.deepEqual(request.body.generationConfig, {
        thinkingConfig: {
            thinkingLevel: 'high'
        }
    });
    assert.deepEqual(request.body.contents[0].parts[1], {
        inline_data: {
            mime_type: 'image/jpeg',
            data: 'YmFzZTY0'
        }
    });
    assert.deepEqual(request.body.contents[0].parts[2], {
        file_data: {
            file_uri: 'gs://bucket/image.png',
            mime_type: 'image/png'
        }
    });
});

test('format router omits Gemini thinkingConfig when thinkingLevel is empty', () => {
    const request = buildProviderRequest({
        providerId: CHAT_PROVIDER_IDS.gemini,
        config: createBaseConfig({
            provider: CHAT_PROVIDER_IDS.gemini,
            apiUrl: 'https://generativelanguage.googleapis.com/v1beta',
            model: 'gemini-2.5-pro',
            thinkingLevel: ''
        }),
        envelope: {
            messages: [{
                role: 'user',
                parts: [{ type: 'text', text: 'hello' }]
            }]
        },
        stream: false,
        apiKey: 'AIza-test'
    });

    assert.equal(request.body.generationConfig, undefined);
});
