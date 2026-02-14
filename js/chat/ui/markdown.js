/**
 * Markdown 渲染器
 *
 * 职责：
 * - 安全地渲染助手消息的 Markdown 内容
 * - 过滤危险的 HTML 标签和属性（防止 XSS 攻击）
 * - 配置 marked.js 和 highlight.js 进行语法高亮
 * - 验证链接和 CSS 类名的安全性
 *
 * 依赖：marked.js, highlight.js（外部库）
 * 被依赖：ui-manager.js
 */

// Markdown 允许的 HTML 标签白名单
const MARKDOWN_ALLOWED_TAGS = new Set([
    'a', 'blockquote', 'br', 'code', 'del', 'em', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'hr', 'li', 'ol', 'p', 'pre', 'strong', 'table', 'tbody', 'td', 'th', 'thead', 'tr', 'ul', 'span'
]);

// 允许的 HTML 属性白名单（按标签分类）
const MARKDOWN_ALLOWED_ATTRS = {
    a: new Set(['href', 'title', 'target', 'rel']),
    code: new Set(['class']),
    span: new Set(['class'])
};

// 安全的链接协议白名单
const SAFE_LINK_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

// 安全的 CSS 类名正则表达式（用于代码高亮）
const SAFE_CODE_CLASS = /^(hljs|hljs-[a-z0-9_-]+|language-[a-z0-9_+#.-]+)$/i;

/**
 * 配置 marked.js
 *
 * 启用 GFM（GitHub Flavored Markdown）和代码高亮
 */
export function setupMarked() {
    if (typeof marked === 'undefined') return;

    marked.setOptions({
        breaks: true,  // 将换行符转换为 <br>
        gfm: true,     // 启用 GitHub Flavored Markdown
        highlight: function (code, lang) {
            if (typeof hljs === 'undefined') return code;
            if (lang && hljs.getLanguage(lang)) {
                return hljs.highlight(code, { language: lang }).value;
            }
            return hljs.highlightAuto(code).value;
        }
    });
}

/**
 * 检查链接是否安全
 *
 * 允许的链接类型：
 * - 相对路径（#、/、./、../）
 * - HTTP/HTTPS/mailto 协议
 *
 * @param {string} href - 链接地址
 * @returns {boolean} 是否安全
 */
function isSafeLink(href) {
    if (!href) return false;
    const value = href.trim();
    if (!value) return false;

    // 允许相对路径
    if (value.startsWith('#') || value.startsWith('/') || value.startsWith('./') || value.startsWith('../')) {
        return true;
    }

    // 检查协议是否在白名单中
    try {
        const parsed = new URL(value, window.location.origin);
        return SAFE_LINK_PROTOCOLS.has(parsed.protocol);
    } catch {
        return false;
    }
}

/**
 * 清理 CSS 类名
 *
 * 只保留符合代码高亮规范的类名（hljs-*、language-*）
 */
function sanitizeClassValue(value) {
    return value
        .split(/\s+/)
        .filter(token => SAFE_CODE_CLASS.test(token))
        .join(' ')
        .trim();
}

/**
 * 清理 Markdown 生成的 HTML
 *
 * 安全措施：
 * 1. 移除不在白名单中的标签
 * 2. 移除危险标签（script、style、iframe 等）
 * 3. 移除不在白名单中的属性
 * 4. 移除事件处理器属性（on*）
 * 5. 验证链接和类名的安全性
 * 6. 为外部链接添加 target="_blank" 和 rel="noopener noreferrer"
 *
 * @param {string} html - 原始 HTML
 * @returns {string} 清理后的 HTML
 */
function sanitizeMarkdownHtml(html) {
    const template = document.createElement('template');
    template.innerHTML = html;

    const nodes = Array.from(template.content.querySelectorAll('*'));
    nodes.forEach((node) => {
        const tag = node.tagName.toLowerCase();

        // 处理不在白名单中的标签
        if (!MARKDOWN_ALLOWED_TAGS.has(tag)) {
            // 危险标签直接移除
            if (['script', 'style', 'iframe', 'object', 'embed', 'link', 'meta', 'base'].includes(tag)) {
                node.remove();
            } else {
                // 其他标签保留内容，移除标签本身
                const fragment = document.createDocumentFragment();
                while (node.firstChild) {
                    fragment.appendChild(node.firstChild);
                }
                node.replaceWith(fragment);
            }
            return;
        }

        // 清理属性
        const allowedAttrs = MARKDOWN_ALLOWED_ATTRS[tag] || new Set();
        Array.from(node.attributes).forEach((attr) => {
            const name = attr.name.toLowerCase();
            const value = attr.value;

            // 移除事件处理器和不在白名单中的属性
            if (name.startsWith('on') || !allowedAttrs.has(name)) {
                node.removeAttribute(attr.name);
                return;
            }

            // 验证链接安全性
            if (name === 'href' && !isSafeLink(value)) {
                node.removeAttribute('href');
                return;
            }

            // 清理 CSS 类名
            if (name === 'class') {
                const safeClass = sanitizeClassValue(value);
                if (safeClass) {
                    node.setAttribute('class', safeClass);
                } else {
                    node.removeAttribute('class');
                }
            }
        });

        // 为外部链接添加安全属性
        if (tag === 'a' && node.hasAttribute('href')) {
            node.setAttribute('target', '_blank');
            node.setAttribute('rel', 'noopener noreferrer');
        }
    });

    return template.innerHTML;
}

/**
 * 转义 HTML 特殊字符
 */
export function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * 渲染 Markdown 文本
 *
 * @param {string} text - Markdown 文本
 * @returns {string} 渲染后的 HTML（已清理）
 */
export function renderMarkdown(text) {
    if (typeof marked === 'undefined') return escapeHtml(text);
    try {
        return sanitizeMarkdownHtml(marked.parse(text));
    } catch {
        return escapeHtml(text);
    }
}

