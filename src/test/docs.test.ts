import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const root = join(__dirname, '../..');
const FILES = [
  'README.md',
  'README.fr.md',
  'CONTRIBUTING.md',
  'SECURITY.md',
  'CHANGELOG.md',
  ...readdirSync(join(root, 'docs'))
    .filter((f) => f.endsWith('.md'))
    .map((f) => `docs/${f}`),
];

/** Relative link and image targets of a Markdown file (code blocks skipped). */
function targets(markdown: string): string[] {
  const text = markdown.replace(/```[\s\S]*?```/g, '');
  const out: string[] = [];
  for (const m of text.matchAll(/!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    const t = m[1] ?? '';
    if (!/^(https?:|mailto:|#)/.test(t)) out.push(t);
  }
  for (const m of text.matchAll(/<img[^>]+src="([^"]+)"/g)) {
    const t = m[1] ?? '';
    if (!/^https?:/.test(t)) out.push(t);
  }
  return out;
}

test.each(FILES)('every relative link and image in %s resolves', (file) => {
  const path = join(root, file);
  expect(existsSync(path), `${file} is missing`).toBe(true);
  const missing = targets(readFileSync(path, 'utf8')).filter((t) => {
    const clean = decodeURI(t.split('#')[0] ?? '');
    return clean !== '' && !existsSync(resolve(dirname(path), clean));
  });
  expect(missing).toEqual([]);
});

test('the English README is the main one and links its French version', () => {
  const readme = readFileSync(join(root, 'README.md'), 'utf8');
  expect(readme).toMatch(/## Features/);
  expect(readme).toMatch(/## Install/);
  expect(readme).toContain('README.fr.md');
});
