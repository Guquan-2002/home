# Start Page

A browser start page built with native ES Modules, featuring dynamic themes, weather, network-aware search, and multi-provider chat (Gemini / OpenAI / Anthropic).
Chinese version: [README.md](README.md)

## Highlights

- Time-driven dynamic backgrounds (morning / day / evening / night)
- Real-time clock and date display
- Weather widget (API key or proxy mode)
- Network status checks with automatic search engine switching (Google / Bing / offline)
- Starfield visual effects
- Multi-provider chat panel (Gemini / OpenAI / Anthropic)
- Chat session management (create / switch / rename / delete / clear)
- Retry by `turnId` (regenerate from a selected user turn)
- Chat context window controls (message count + token budget)
- Pseudo-stream output (toggleable, front-end progressive rendering)
- Per-session draft autosave (toggleable, restored on switch/reload)
- One-click "Refill input" on error bubble (refill only, no auto-send)
- Provider-specific config profiles (switching provider restores URL/key/model/thinking/search; OpenAI Reasoning Effort persists)
- Node built-in tests for chat core logic

## Tech Stack

- HTML + CSS (no build step)
- Vanilla JavaScript (ES Modules)
- Fetch API
- `localStorage` persistence
- Marked + highlight.js for markdown/code rendering in chat

## Project Structure

```text
home/
|-- index.html
|-- package.json
|-- css/
|   |-- variables.css
|   |-- base.css
|   |-- animations.css
|   |-- components.css
|   |-- chat.css
|   `-- mobile.css
|-- js/
|   |-- main.js
|   |-- config.js
|   |-- utils.js
|   |-- time.js
|   |-- theme.js
|   |-- weather.js
|   |-- network.js
|   |-- starfield.js
|   |-- mobile.js
|   |-- chat.js
|   |-- shared/
|   |   `-- safe-storage.js
|   `-- chat/
|       |-- api.js
|       |-- config.js
|       |-- constants.js
|       |-- custom-select.js
|       |-- history.js
|       |-- markdown.js
|       |-- ui.js
|       |-- core/
|       |   |-- message-model.js
|       |   |-- marker-stream-splitter.js
|       |   |-- context-window.js
|       |   |-- prefix.js
|       |   `-- pseudo-stream.js
|       |-- state/
|       |   `-- session-store.js
|       |-- storage/
|       |   |-- history-storage.js
|       |   `-- draft-storage.js
|       `-- providers/
|           |-- provider-interface.js
|           |-- provider-router.js
|           |-- gemini-provider.js
|           |-- openai-provider.js
|           `-- anthropic-provider.js
|-- tests/
|   `-- chat/
|       |-- anthropic-provider.test.mjs
|       |-- config-manager.test.mjs
|       |-- message-model.test.mjs
|       |-- context-window.test.mjs
|       |-- session-store.test.mjs
|       |-- gemini-provider-stream.test.mjs
|       |-- gemini-provider.test.mjs
|       |-- openai-provider.test.mjs
|       |-- marker-stream-splitter.test.mjs
|       |-- pseudo-stream.test.mjs
|       `-- draft-storage.test.mjs
|-- README.md
`-- README.en.md
```

## Chat Architecture Layers

- `js/chat.js`: composition root (wires store / provider / UI / history / config / drafts)
- `js/chat/state/session-store.js`: single state entry for sessions + generation lifecycle
- `js/chat/storage/history-storage.js`: `llm_chat_history_v2` read/write and schema normalization
- `js/chat/storage/draft-storage.js`: `llm_chat_drafts_v1` draft read/write and normalization
- `js/chat/core/*`: pure logic (message model, prefixes, context window, pseudo-stream chunking/runner)
- `js/chat/providers/provider-router.js`: routes by `config.provider` to Gemini/OpenAI/Anthropic
- `js/chat/providers/*-provider.js`: provider request handling (stream/non-stream), retry, backup-key fallback, error handling
- `js/chat/ui.js` + `js/chat/history.js`: rendering and interaction control (no direct persistence)

## Quick Start

### Option 1: Open directly

Open `index.html` in your browser.

### Option 2: Run a local static server

```bash
# Python 3
python -m http.server 8000

# Node.js
npx serve
```

Then open `http://localhost:8000`.

### Run tests

```bash
# Recommended
npm test

# Or
node --test tests/chat/*.test.mjs
```

## Configuration

### 1) Weather (Seniverse)

You can configure weather in one of these ways:

1. Set `startpage_config.weatherApiKey` in `localStorage`
2. Inject `window.__STARTPAGE_CONFIG__` before scripts load
3. Set `startpage_config.weatherProxyUrl` to use a backend proxy (recommended)

Example:

```js
localStorage.setItem('startpage_config', JSON.stringify({
  weatherApiKey: 'YOUR_SENIVERSE_API_KEY'
}));
```

### 2) Chat (Gemini / OpenAI / Anthropic)

Configure in chat settings:

- Provider (Gemini / OpenAI / Anthropic)
- API URL defaults:
  - Gemini: `https://generativelanguage.googleapis.com/v1beta`
  - OpenAI: `https://api.openai.com/v1`
  - Anthropic: `https://api.anthropic.com/v1`
- Primary / backup API key
- Model name (for example: `gemini-2.5-pro` / `gpt-4o-mini` / `claude-sonnet-4-5-20250929`)
- System prompt
- Thinking (optional):
  - Gemini / Anthropic: positive integer budget
  - OpenAI: `none|minimal|low|medium|high|xhigh`
- Web search (optional):
  - Gemini: `gemini_google_search`
  - Anthropic: `anthropic_web_search`
  - OpenAI: `openai_web_search_low|medium|high`
- Experience toggles (pseudo-stream, draft autosave)
- Message prefix (timestamp, user name)

Note: config is stored per provider. Switching provider restores that provider profile. OpenAI Reasoning Effort is preserved across switches.

## Chat Behavior Notes

- Gemini / OpenAI / Anthropic are supported through the provider router
- Sessions are persisted in `llm_chat_history_v2` (schema version 2)
- Drafts are persisted per session in `llm_chat_drafts_v1`
- With pseudo-stream enabled, real-time marker split is used: `<|CHANGE_ROLE|>` and `<|END_SENTENCE|>` trigger segment flush
- With pseudo-stream disabled, marker tokens are not split (treated as plain text)
- Stop behavior: abort during request; stop render loop during pseudo-stream and keep partial output
- Request failures show an error bubble with a "Refill input" action
- Retry on a user message rolls back by `turnId` (that turn and all later messages)
- Session operations are blocked while generation is in progress

## Local Storage Keys

- `llm_chat_config`: chat configuration
- `llm_chat_history_v2`: chat session history (v2)
- `llm_chat_drafts_v1`: chat drafts (per session)
- `startpage_config`: runtime settings (weather, etc.)

## Debug Flags (Optional)

- `window.__CHAT_CONTEXT_DEBUG__ = true`
- `localStorage.setItem('llm_chat_context_debug', '1')`
- `window.__CHAT_CONTEXT_MAX_MESSAGES__ = 80`
- `localStorage.setItem('llm_chat_context_max_messages', '80')`

## Browser Compatibility

- Chrome / Edge 90+
- Firefox 88+
- Safari 14+
- Mainstream mobile browsers (iOS Safari, Chrome Mobile, Firefox Mobile)

Requires ES Modules and CSS Variables support.

## License

MIT License

Copyright (c) 2026 梏权

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
