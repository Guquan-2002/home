# Start Page

一个基于原生 ES Modules 的浏览器起始页，集成动态主题、天气、网络感知搜索和多 Provider Chat（Gemini / OpenAI / Anthropic）。
English version: [README.en.md](README.en.md)

## 功能亮点

- 时间驱动动态背景（晨间 / 白天 / 傍晚 / 夜间）
- 实时时钟与日期展示
- 天气组件（支持 API Key 或代理模式）
- 网络状态检测 + 搜索引擎自动切换（Google / Bing / 离线）
- 星空背景特效
- 多 Provider 聊天（Gemini / OpenAI / Anthropic）
- 聊天会话管理（新建 / 切换 / 重命名 / 删除 / 清空）
- 按 `turnId` 回退重试（从指定用户轮次重新生成）
- 聊天上下文窗口控制（消息数 + Token 预算）
- 伪流式输出（可开关，前端分段渲染）
- 按会话草稿自动保存（可开关，切换/刷新可恢复）
- 失败气泡一键“回填输入框”（仅回填，不自动发送）
- Provider 独立配置档案（切换 Provider 自动回填 URL/Key/Model/Thinking/Search；OpenAI Reasoning Effort 可保存）
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

## Chat 架构分层

- `js/chat.js`：组合根（装配 store / provider / UI / history / config / drafts）
- `js/chat/state/session-store.js`：会话 + 生成态单一状态入口
- `js/chat/storage/history-storage.js`：`llm_chat_history_v2` 读写与 schema 归一化
- `js/chat/storage/draft-storage.js`：`llm_chat_drafts_v1` 草稿读写与归一化
- `js/chat/core/*`：纯逻辑（消息模型、前缀、上下文窗口、伪流式分块/执行）
- `js/chat/providers/provider-router.js`：按 `config.provider` 路由到 Gemini/OpenAI/Anthropic
- `js/chat/providers/*-provider.js`：Provider 请求、流式/非流式、重试、fallback key、错误处理
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
3. 使用 `startpage_config.weatherProxyUrl` 走后端代理（推荐，避免前端暴露密钥）

示例：

```js
localStorage.setItem('startpage_config', JSON.stringify({
  weatherApiKey: 'YOUR_SENIVERSE_API_KEY'
}));
```

### 2) 聊天配置（Gemini / OpenAI / Anthropic）

在聊天设置中配置：

- Provider（Gemini / OpenAI / Anthropic）
- API URL（默认：
  - Gemini: `https://generativelanguage.googleapis.com/v1beta`
  - OpenAI: `https://api.openai.com/v1`
  - Anthropic: `https://api.anthropic.com/v1`
    ）
- 主/备 API Key
- 模型名（例如 `gemini-2.5-pro` / `gpt-4o-mini` / `claude-sonnet-4-5-20250929`）
- System Prompt
- Thinking（可选）：
  - Gemini / Anthropic：正整数预算
  - OpenAI：`none|minimal|low|medium|high|xhigh`
- Web Search（可选）：
  - Gemini：`gemini_google_search`
  - Anthropic：`anthropic_web_search`
  - OpenAI：`openai_web_search_low|medium|high`
- Experience（伪流式开关、草稿自动保存开关）
- Message Prefix（时间戳、用户名前缀）

说明：配置按 Provider 独立保存；切换 Provider 会自动回填对应配置。OpenAI 的 Reasoning Effort 在切换后可持续保留。

## 聊天行为要点

- 支持 Gemini / OpenAI / Anthropic Provider（统一走 provider router）
- 会话历史使用 `llm_chat_history_v2`（schema version = 2）
- 草稿按会话保存到 `llm_chat_drafts_v1`
- 开启伪流式时支持实时分段：检测 `<|CHANGE_ROLE|>` 与 `<|END_SENTENCE|>` 标记即落地段落
- 关闭伪流式时不按标记拆分（标记按普通文本处理）
- 点击 Stop：请求中会 Abort；伪流式中会停止渲染并保留已输出内容
- 请求失败时显示错误气泡，支持“回填输入框”
- 点击用户消息重试按钮会按 `turnId` 回退该轮及其后续消息
- 生成中会阻止切会话/新建/清空等操作（避免状态错乱）

## 本地存储键

- `llm_chat_config`：聊天配置
- `llm_chat_history_v2`：聊天会话历史（V2）
- `llm_chat_drafts_v1`：聊天草稿（按会话）
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
