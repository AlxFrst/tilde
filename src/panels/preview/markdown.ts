// Markdown to HTML for the preview. Raw HTML is off (it shows as text) and only web,
// mail and in-page links survive, so a hostile README cannot run anything.

import MarkdownIt from 'markdown-it';
import { t } from '@/i18n';

const md = new MarkdownIt({ html: false, linkify: true, typographer: false });

const SAFE_LINK = /^(https?:|mailto:|#)/i;
md.validateLink = (url: string) => SAFE_LINK.test(url.trim());

// Images are not fetched (the CSP forbids remote ones anyway): their text shows instead.
md.renderer.rules.image = (tokens, idx, _options, env) => {
  const token = tokens[idx];
  const alt = token ? md.utils.escapeHtml(token.content || String(token.attrGet('src') ?? '')) : '';
  const title = md.utils.escapeHtml((env as { imageTitle?: string }).imageTitle ?? '');
  return `<span class="md-image" title="${title}">🖼 ${alt}</span>`;
};

/** `imageTitle`: the tooltip of an image left out, in the interface's language. */
export function renderMarkdown(text: string, imageTitle = t('Image non chargée')): string {
  return md.render(text, { imageTitle });
}
