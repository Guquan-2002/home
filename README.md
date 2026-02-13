# Start Page

一个基于原生 ES Modules 的浏览器起始页项目，集成了动态主题、天气、网络感知搜索和 Gemini 聊天面板。
English version: [README.en.md](README.en.md)

## 功能亮点

- 时间驱动的动态背景主题（晨间 / 白天 / 傍晚 / 夜间）
- 实时时钟与日期展示
- 天气组件（支持 API Key 或代理模式）
- 网络状态检测 + 搜索引擎自动切换（Google / Bing / 离线）
- 星空背景特效
- Gemini 聊天面板（仅 Gemini，不支持 OpenAI/Anthropic）
- 聊天会话管理（新建 / 切换 / 重命名 / 删除 / 清空）
- 按 `turn` 回退重试（从指定用户轮次重新生成）
- 聊天上下文窗口控制（消息数 + Token 预算）
- Node 内置测试覆盖 chat 核心逻辑

## 技术栈

- HTML + CSS（无构建步骤）
- Vanilla JavaScript（ES Modules）
- Fetch API
- `localStorage` 持久化
- Marked + highlight.js（聊天 Markdown/代码高亮）

## 项目结构

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

## Chat 架构分层

- `js/chat.js`：组合根（装配 store / provider / UI / history / config）
- `js/chat/state/session-store.js`：会话与流式状态单一数据源
- `js/chat/storage/history-storage.js`：`llm_chat_history_v2` 读写与 schema 归一化
- `js/chat/core/*`：纯逻辑（消息模型、前缀、上下文窗口）
- `js/chat/providers/gemini-provider.js`：Gemini 调用、重试、fallback key、错误处理
- `js/chat/ui.js` + `js/chat/history.js`：渲染与交互控制（不直接持久化）

## 快速开始

### 方式 1：直接打开

直接在浏览器中打开 `index.html`。

### 方式 2：本地静态服务

```bash
# Python 3
python -m http.server 8000

# Node.js
npx serve
```

然后访问 `http://localhost:8000`。

### 运行测试

```bash
# 推荐
npm test

# 或
node --test tests/chat/*.test.mjs
```

## 配置说明

### 1) 天气配置（心知天气）

支持以下三种方式：

1. `localStorage` 中写入 `startpage_config.weatherApiKey`
2. 页面启动前注入 `window.__STARTPAGE_CONFIG__`
3. 使用 `startpage_config.weatherProxyUrl` 走后端代理（更推荐，避免前端暴露密钥）

示例：

```js
localStorage.setItem('startpage_config', JSON.stringify({
  weatherApiKey: 'YOUR_SENIVERSE_API_KEY'
}));
```

### 2) 聊天配置（Gemini Only）

在聊天设置中配置：

- Gemini API URL（默认 `https://generativelanguage.googleapis.com/v1beta`）
- 主/备 API Key
- 模型名（如 `gemini-2.5-pro`）
- System Prompt
- Thinking Budget（可选）
- Web Search（可选，Gemini Google Search）
- Message Prefix（时间戳、用户名前缀）

## 聊天行为要点

- 仅支持 Gemini Provider（内部接口已预留扩展能力）
- 历史会话存储为 `llm_chat_history_v2`（schema version = 2）
- 若助手输出包含 `<|CHANGE_ROLE|>`，会拆分为多条 assistant 消息
- 点击用户消息重试按钮会按 `turnId` 回退该轮及其后续消息
- 会话操作在生成中会被阻止（避免状态错乱）

## 本地存储键

- `llm_chat_config`：聊天配置
- `llm_chat_history_v2`：聊天会话历史（V2）
- `startpage_config`：运行时配置（天气等）

## 调试开关（可选）

- `window.__CHAT_CONTEXT_DEBUG__ = true`
- `localStorage.setItem('llm_chat_context_debug', '1')`
- `window.__CHAT_CONTEXT_MAX_MESSAGES__ = 80`
- `localStorage.setItem('llm_chat_context_max_messages', '80')`

## 兼容性

- Chrome / Edge 90+
- Firefox 88+
- Safari 14+
- 主流移动端浏览器（iOS Safari、Chrome Mobile、Firefox Mobile）

要求：浏览器支持 ES Modules 与 CSS Variables。

## 许可证

MIT License
