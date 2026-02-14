import test from 'node:test';
import assert from 'node:assert/strict';
import { CHAT_PROVIDER_IDS } from '../../js/chat/constants.js';
import { getThinkingOptions, normalizeFromUi, formatForUi, getUiMeta } from '../../js/chat/app/thinking-config.js';

const DUMMY_PROFILE = Object.freeze({});

// OpenAI: support none/minimal/low/medium/high/xhigh
test('thinking-config openai options and mapping', () => {
  const opts = getThinkingOptions(CHAT_PROVIDER_IDS.openai).map(o => o.value);
  assert.deepEqual(opts, ['none','minimal','low','medium','high','xhigh']);
  assert.equal(normalizeFromUi(CHAT_PROVIDER_IDS.openai, 'xhigh').field, 'thinkingBudget');
  assert.equal(normalizeFromUi(CHAT_PROVIDER_IDS.openai, 'xhigh').value, 'xhigh');
  assert.equal(formatForUi(CHAT_PROVIDER_IDS.openai, { thinkingBudget: 'none' }), 'none');
  assert.ok(getUiMeta(CHAT_PROVIDER_IDS.openai).note.includes('xhigh'));
});

// Ark: none + minimal..high (none disables)
test('thinking-config ark options and mapping', () => {
  const opts = getThinkingOptions(CHAT_PROVIDER_IDS.arkResponses).map(o => o.value);
  assert.deepEqual(opts, ['none','minimal','low','medium','high']);
  const m = normalizeFromUi(CHAT_PROVIDER_IDS.arkResponses, 'none');
  assert.equal(m.field, 'thinkingBudget');
  assert.equal(m.value, 'none');
  assert.equal(formatForUi(CHAT_PROVIDER_IDS.arkResponses, { thinkingBudget: 'medium' }), 'medium');
});

// Anthropic: none/low/medium/high
test('thinking-config anthropic options and mapping', () => {
  const opts = getThinkingOptions(CHAT_PROVIDER_IDS.anthropic).map(o => o.value);
  assert.deepEqual(opts, ['none','low','medium','high']);
  const m = normalizeFromUi(CHAT_PROVIDER_IDS.anthropic, 'none');
  assert.equal(m.field, 'thinkingEffort');
  assert.equal(m.value, 'none');
  assert.equal(formatForUi(CHAT_PROVIDER_IDS.anthropic, { thinkingEffort: 'high' }), 'high');
});

// Gemini: off/low/medium/high, off means disable
test('thinking-config gemini options and mapping', () => {
  const opts = getThinkingOptions(CHAT_PROVIDER_IDS.gemini).map(o => o.value);
  assert.deepEqual(opts, ['off','low','medium','high']);
  const m = normalizeFromUi(CHAT_PROVIDER_IDS.gemini, 'off');
  assert.equal(m.field, 'thinkingLevel');
  assert.equal(m.value, 'off');
  assert.equal(formatForUi(CHAT_PROVIDER_IDS.gemini, { thinkingLevel: 'medium' }), 'medium');
});
