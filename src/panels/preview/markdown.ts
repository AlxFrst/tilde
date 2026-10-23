// Markdown to HTML for the preview. Raw HTML is off (it shows as text) and only web,
// mail and in-page links survive, so a hostile README cannot run anything.

import MarkdownIt from 'markdown-it';

const md = new MarkdownIt({ html: false, linkify: true, typographer: false });

const SAFE_LINK = /^(https?:|mailto:|#)/i;
md.validateLink = (url: string) => SAFE_LINK.test(url.trim());

// Images are not fetched (the CSP forbids remote ones anyway): their text shows instead.
md.renderer.rules.image = (tokens, idx) => {
  const token = tokens[idx];
  const alt = token ? md.utils.escapeHtml(token.content || String(token.attrGet('src') ?? '')) : '';
  return `<span class="md-image" title="Image non chargée">🖼 ${alt}</span>`;
};

export function renderMarkdown(text: string): string {
  return md.render(text);
}
