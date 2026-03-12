import MarkdownIt from 'markdown-it';
import hljs from 'highlight.js';

export class MarkdownRenderer {
    private readonly md: MarkdownIt;

    constructor() {
        this.md = new MarkdownIt({
            html: false,
            linkify: true,
            breaks: true,
            typographer: false,
        });

        this.configureLinks();
        this.configureCodeBlocks();
    }

    render(markdown: string): string {
        if (!markdown.trim()) {
            return '';
        }

        return this.md.render(markdown);
    }

    private configureLinks() {
        const defaultLinkOpen = this.md.renderer.rules.link_open
            ?? ((tokens, index, options, env, self) => self.renderToken(tokens, index, options));

        this.md.renderer.rules.link_open = (tokens, index, options, env, self) => {
            tokens[index].attrSet('target', '_blank');
            tokens[index].attrSet('rel', 'noopener noreferrer');
            return defaultLinkOpen(tokens, index, options, env, self);
        };
    }

    private configureCodeBlocks() {
        this.md.renderer.rules.fence = (tokens, index) => {
            const token = tokens[index];
            const info = token.info.trim();
            const lang = info.split(/\s+/)[0] || 'text';
            const highlighted = this.highlight(token.content, lang);
            const safeLang = this.md.utils.escapeHtml(lang);

            return [
                '<div class="code-shell">',
                '<div class="code-shell__header">',
                `<span class="code-shell__lang">${safeLang}</span>`,
                '<button class="code-copy-button" type="button">复制</button>',
                '</div>',
                `<pre><code class="hljs language-${safeLang}">${highlighted}</code></pre>`,
                '</div>',
            ].join('');
        };
    }

    private highlight(code: string, lang: string): string {
        try {
            if (lang && hljs.getLanguage(lang)) {
                return hljs.highlight(code, {
                    language: lang,
                    ignoreIllegals: true,
                }).value;
            }

            return this.md.utils.escapeHtml(code);
        } catch (error) {
            return this.md.utils.escapeHtml(code);
        }
    }
}
