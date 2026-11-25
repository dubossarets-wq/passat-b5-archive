import MarkdownIt from 'markdown-it';
import { raw } from './html.js';
import { protectSpecs, expandSpecs } from './specs.js';

// HTML внутри Markdown отключён: статьи — только текст и разметка.
const md = new MarkdownIt({ html: false, linkify: true, breaks: false, typographer: false });

const defaultLink = md.renderer.rules.link_open ?? ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));
md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  const href = tokens[idx].attrGet('href') ?? '';
  if (/^https?:/i.test(href)) {
    tokens[idx].attrSet('target', '_blank');
    tokens[idx].attrSet('rel', 'noopener noreferrer');
  }
  return defaultLink(tokens, idx, options, env, self);
};

export function renderMarkdown(source) {
  return raw(expandSpecs(md.render(protectSpecs(source))));
}
