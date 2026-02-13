# Start Page

A browser start page built with native ES Modules, featuring dynamic themes, weather, network-aware search, and a Gemini chat panel.
Chinese version: [README.md](README.md)

## Highlights

- Time-driven dynamic backgrounds (morning / day / evening / night)
- Real-time clock and date display
- Weather widget (API key or proxy mode)
- Network status checks with automatic search engine switching (Google / Bing / offline)
- Starfield visual effects
- Gemini chat panel (Gemini-only; no OpenAI/Anthropic)
- Chat session management (create / switch / rename / delete / clear)
- Retry by `turn` (regenerate from a selected user turn)
- Chat context window controls (message count + token budget)
- Node built-in tests for chat core logic

## Tech Stack

- HTML + CSS (no build step)
- Vanilla JavaScript (ES Modules)
- Fetch API
- `localStorage` persistence
- Marked + highlight.js for markdown and code rendering in chat

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
|       |   |-- context-window.js
|       |   `-- prefix.js
|       |-- state/
|       |   `-- session-store.js
|       |-- storage/
|       |   `-- history-storage.js
|       `-- providers/
|           |-- provider-interface.js
|           `-- gemini-provider.js
|-- tests/
|   `-- chat/
|       |-- message-model.test.mjs
|       |-- context-window.test.mjs
|       |-- session-store.test.mjs
|       `-- gemini-provider.test.mjs
`-- README.md
```

## Chat Architecture Layers

- `js/chat.js`: composition root (wires store / provider / UI / history / config)
- `js/chat/state/session-store.js`: single source of truth for sessions + streaming state
- `js/chat/storage/history-storage.js`: `llm_chat_history_v2` read/write and schema normalization
- `js/chat/core/*`: pure logic (message model, prefixes, context window)
- `js/chat/providers/gemini-provider.js`: Gemini calls, retry, backup-key fallback, error handling
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

### 2) Chat (Gemini only)

Configure in chat settings:

- Gemini API URL (default: `https://generativelanguage.googleapis.com/v1beta`)
- Primary / backup API key
- Model name (for example: `gemini-2.5-pro`)
- System prompt
- Thinking budget (optional)
- Web search (optional, Gemini Google Search)
- Message prefix (timestamp, user name)

## Chat Behavior Notes

- Gemini is the only active provider (interface is prepared for future extension)
- Sessions are persisted in `llm_chat_history_v2` (schema version 2)
- Assistant output containing `<|CHANGE_ROLE|>` is split into multiple assistant messages
- Retry on a user message rolls back by `turnId` (that turn and all later messages)
- Session operations are blocked while generation is in progress

## Local Storage Keys

- `llm_chat_config`: chat configuration
- `llm_chat_history_v2`: chat session history (v2)
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
