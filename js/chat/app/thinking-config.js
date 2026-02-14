/**
 * Thinking configuration helper.
 *
 * Centralizes provider-specific options, UI mapping, and normalization.
 * This module does NOT change storage schema; it only helps map UI <select>
 * values to existing per-provider fields:
 * - OpenAI / OpenAI Responses / Ark: thinkingBudget (string | null)
 * - Anthropic: thinkingEffort (string | null)
 * - Gemini: thinkingLevel (string | null)
 */
import { CHAT_PROVIDER_IDS } from '../constants.js';

function normProviderId(providerId) {
  return typeof providerId === 'string' ? providerId.trim().toLowerCase() : '';
}

// Option lists per provider
const OPENAI_OPTIONS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'];
const ARK_OPTIONS = ['none', 'minimal', 'low', 'medium', 'high'];
const ANTHROPIC_OPTIONS = ['none', 'low', 'medium', 'high'];
const GEMINI_OPTIONS = ['off', 'low', 'medium', 'high'];

/**
 * Get UI label and note for current provider.
 */
export function getUiMeta(providerId) {
  const id = normProviderId(providerId);
  return {
    label: 'Reasoning (optional)',
    note:
      id === CHAT_PROVIDER_IDS.openai || id === CHAT_PROVIDER_IDS.openaiResponses
        ? 'OpenAI: none/minimal/low/medium/high/xhigh; choose none to disable.'
        : id === CHAT_PROVIDER_IDS.arkResponses
          ? 'Ark: minimal/low/medium/high; choose Disabled to turn off.'
          : id === CHAT_PROVIDER_IDS.anthropic
            ? 'Anthropic: none/low/medium/high; none disables (adaptive otherwise).'
            : 'Gemini: off/low/medium/high; off disables.'
  };
}

/**
 * Return select options for the given provider.
 * Each option is { value, label }.
 * The first item is the semantic "¹Ø±Õ" option where applicable.
 */
export function getThinkingOptions(providerId) {
  const id = normProviderId(providerId);
  let values;
  if (id === CHAT_PROVIDER_IDS.openai || id === CHAT_PROVIDER_IDS.openaiResponses) {
    values = OPENAI_OPTIONS;
  } else if (id === CHAT_PROVIDER_IDS.arkResponses) {
    values = ARK_OPTIONS;
  } else if (id === CHAT_PROVIDER_IDS.anthropic) {
    values = ANTHROPIC_OPTIONS;
  } else {
    values = GEMINI_OPTIONS;
  }

  // Map values to UI labels. Unify the first "disable" label as ¹Ø±Õ.
  return values.map((v, idx) => ({
    value: v,
    label: idx === 0 ? 'Disabled' : v
  }));
}

/**
 * Normalize a UI value (from <select>.value) into provider-specific field.
 * Returns { field, value } where value is string or null.
 * - When the UI value is an empty string (e.g., "Auto" placeholder), return null.
 * - For providers where disabling equals a special token (Gemini=off, Anthropic=none,
 *   OpenAI=none, Ark=none), return that token (except Ark can also be omitted by null).
 */
export function normalizeFromUi(providerId, uiValue) {
  const id = normProviderId(providerId);
  const raw = typeof uiValue === 'string' ? uiValue.trim().toLowerCase() : '';

  if (id === CHAT_PROVIDER_IDS.anthropic) {
    // allow none/low/medium/high; empty => null
    const allowed = new Set(ANTHROPIC_OPTIONS);
    return { field: 'thinkingEffort', value: raw ? (allowed.has(raw) ? raw : null) : null };
  }

  if (id === CHAT_PROVIDER_IDS.gemini) {
    // allow off/low/medium/high; empty => null
    const allowed = new Set(GEMINI_OPTIONS);
    return { field: 'thinkingLevel', value: raw ? (allowed.has(raw) ? raw : null) : null };
  }

  if (id === CHAT_PROVIDER_IDS.arkResponses) {
    // allow minimal/low/medium/high; none means disabled (we keep 'none' for UI, or null to omit)
    const allowed = new Set(['minimal', 'low', 'medium', 'high', 'none']);
    const val = raw ? (allowed.has(raw) ? raw : null) : null;
    return { field: 'thinkingBudget', value: val };
  }

  // OpenAI family
  const allowed = new Set(OPENAI_OPTIONS);
  return { field: 'thinkingBudget', value: raw ? (allowed.has(raw) ? raw : null) : null };
}

/**
 * Given a provider profile object, return the UI value to assign to the <select>.
 * Falls back to '' (no selection) if the stored value is not recognized.
 */
export function formatForUi(providerId, profile) {
  const id = normProviderId(providerId);
  if (id === CHAT_PROVIDER_IDS.anthropic) {
    const v = typeof profile?.thinkingEffort === 'string' ? profile.thinkingEffort.trim().toLowerCase() : '';
    return ANTHROPIC_OPTIONS.includes(v) ? v : '';
  }
  if (id === CHAT_PROVIDER_IDS.gemini) {
    const v = typeof profile?.thinkingLevel === 'string' ? profile.thinkingLevel.trim().toLowerCase() : '';
    return GEMINI_OPTIONS.includes(v) ? v : '';
  }
  if (id === CHAT_PROVIDER_IDS.arkResponses) {
    const v = typeof profile?.thinkingBudget === 'string' ? profile.thinkingBudget.trim().toLowerCase() : '';
    return ARK_OPTIONS.includes(v) ? v : '';
  }
  // OpenAI family
  const v = typeof profile?.thinkingBudget === 'string' ? profile.thinkingBudget.trim().toLowerCase() : '';
  return OPENAI_OPTIONS.includes(v) ? v : '';
}

