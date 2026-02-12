# Start Page

A modular browser start page with dynamic themes, weather status, smart search engine switching, and an integrated AI chat panel.

## Features

- Dynamic background theme based on local time (morning/day/evening/night)
- Real-time clock and date display
- Weather widget with configurable API key or proxy
- Network-aware search engine switching (Google/Bing/offline)
- Starfield background effects
- AI chat panel with **Gemini-only** provider support
- Chat history management (new session, rename, delete, clear all)
- Config persistence through `localStorage`
- Context-window controls (token budget + message-count budget)
- Assistant message segmentation with `<|CHANGE_ROLE|>` marker

## Project Structure

```text
home/
|-- index.html
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
|   `-- chat/
|       |-- api.js
|       |-- config.js
|       |-- constants.js
|       |-- custom-select.js
|       |-- history.js
|       |-- markdown.js
|       `-- ui.js
`-- README.md
```

## Usage

### Run locally

1. Open `index.html` directly in your browser, or
2. Start a local static server:

```bash
# Python 3
python -m http.server 8000

# Node.js
npx serve
```

3. Open `http://localhost:8000`.

### Set as browser homepage

- Chrome/Edge: Settings -> On startup -> Open a specific page -> add `file:///path/to/home/index.html`
- Firefox: Settings -> Home -> set homepage to the same file path

## AI Chat Configuration (Gemini Only)

This project supports **Gemini API only** in the chat panel.
OpenAI and Anthropic providers are intentionally not supported.

1. Open the chat panel from the floating chat button.
2. Open chat settings.
3. Configure:
   - **Gemini API URL** (example: `https://generativelanguage.googleapis.com/v1beta`)
   - **Primary API Key**
   - **Backup API Key** (optional)
   - **Gemini Model** (example: `gemini-2.5-pro`)
   - **System Prompt** (optional)
   - **Thinking Budget** (optional)
   - **Web Search** (`Disabled` or `Gemini Google Search`)
   - **Message Prefix**
     - **Add timestamp prefix**: adds a timestamp as a separate centered system-style message before each user message
     - **Add user name prefix**: adds user-name tag (for example `【User】`) to user messages only
     - **User Name**: custom user prefix label
4. Click **Save Settings**.

Chat settings are stored in `localStorage` under `llm_chat_config`.
Chat sessions are stored under `llm_chat_history`.

### Chat behavior notes

- Search grounding sources are not appended to chat bubbles and are not stored in chat context.
- If assistant output includes `<|CHANGE_ROLE|>`, the response is split into multiple assistant messages.
- Each split assistant segment is rendered as an independent bubble and stored as an independent context/history message.
- Timestamp prefix messages are stored as independent context entries (not merged into the user text body).

## Weather API Configuration

The weather module uses Seniverse weather APIs. To avoid hardcoding secrets, credentials are not committed to source.

You can configure weather in one of the following ways:

1. Set `weatherApiKey` in browser `localStorage`:

```js
localStorage.setItem('startpage_config', JSON.stringify({
  weatherApiKey: 'YOUR_SENIVERSE_API_KEY'
}));
```

2. Inject global runtime config before app scripts load:

```html
<script>
  window.__STARTPAGE_CONFIG__ = {
    weatherApiKey: 'YOUR_SENIVERSE_API_KEY'
  };
</script>
```

3. Prefer backend proxy mode to avoid exposing keys in frontend code:

```js
localStorage.setItem('startpage_config', JSON.stringify({
  weatherProxyUrl: 'https://your-server.example.com/weather'
}));
```

Seniverse site: https://www.seniverse.com/

## Tech Stack

- Vanilla JavaScript (ES modules)
- HTML + CSS (no build step required)
- Fetch API
- `localStorage` persistence
- Marked + highlight.js for markdown/code rendering in chat

## Browser Compatibility

- Chrome / Edge 90+
- Firefox 88+
- Safari 14+
- Mobile browsers (iOS Safari 14+, Chrome Mobile, Firefox Mobile)

Requires support for ES modules and CSS variables.

## Mobile Optimization

This start page is fully optimized for mobile devices with the following enhancements:

### Responsive Design
- Adaptive layout for phones, tablets, and desktops
- Optimized font sizes and spacing for different screen sizes
- Support for both portrait and landscape orientations
- Dynamic viewport height handling (iOS Safari compatible)

### Touch Interactions
- Enlarged touch targets (minimum 44x44px)
- Haptic feedback for important actions (if supported)
- Smooth touch scrolling with momentum
- Prevention of double-tap zoom
- Optimized button sizes and spacing

### Chat Panel Mobile Features
- Full-screen chat panel on mobile devices
- Keyboard-aware input field positioning
- Auto-adjusting textarea height
- Always-visible copy and retry buttons
- Optimized code block scrolling
- Background scroll lock when chat is open

### Performance
- Reduced animation complexity on mobile
- Optimized star field effects
- Hardware-accelerated scrolling
- Efficient touch event handling

### Input Optimization
- 16px minimum font size to prevent iOS auto-zoom
- Proper keyboard handling (Enter to submit)
- Smooth keyboard show/hide transitions
- Input field stays visible when keyboard appears

## Customization

### Theme time ranges

Edit `updateBackground()` in `js/theme.js`:

```js
if (hour >= 6 && hour < 8) theme = 'morning';
else if (hour >= 8 && hour < 16) theme = 'day';
else if (hour >= 16 && hour < 18) theme = 'evening';
```

### Theme colors

Edit gradients in `css/variables.css`:

```css
--morning-gradient: linear-gradient(...);
--day-gradient: linear-gradient(...);
--evening-gradient: linear-gradient(...);
--night-gradient: linear-gradient(...);
```

### Update intervals

Edit `CONFIG` in `js/config.js`:

```js
export const CONFIG = {
  WEATHER_UPDATE_INTERVAL: 30 * 60 * 1000,
  NETWORK_CHECK_INTERVAL: 10 * 1000,
  THEME_CHECK_INTERVAL: 60 * 1000,
  TIME_UPDATE_INTERVAL: 1000
};
```

## License

MIT License

## Changelog

### v2.1.0

- Added comprehensive mobile device optimization
- Implemented responsive design for all screen sizes
- Added touch interaction enhancements
- Optimized chat panel for mobile devices
- Added keyboard-aware input handling
- Implemented haptic feedback support
- Added landscape/portrait orientation support
- Optimized performance for mobile browsers

### v2.0.0

- Refactored from single-file implementation into modular structure
- Separated CSS and JavaScript concerns
- Improved readability and maintainability

### v1.0.0

- Initial release
