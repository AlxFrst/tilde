import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const css = readFileSync(join(__dirname, '../styles/globals.css'), 'utf8');

test('scrollbars are drawn with the theme colours, not the system ones', () => {
  expect(css).toMatch(/::-webkit-scrollbar\s*\{[^}]*width/);
  expect(css).toMatch(/::-webkit-scrollbar-thumb\s*\{[^}]*var\(--tilde-/);
  expect(css).toMatch(/::-webkit-scrollbar-corner\s*\{[^}]*transparent/);
});

test('native drop-down lists use the theme, not white on white in dark mode', () => {
  expect(css).toMatch(
    /option[^{]*\{[^}]*background-color:\s*var\(--tilde-surface-2\)[^}]*color:\s*var\(--tilde-text\)/,
  );
});

test('app code takes the brand accent from `primary`, not shadcn’s `accent` surface', () => {
  // `accent` is shadcn's hover background (surface-2): text or a dot in that colour
  // disappears into the sidebar. Only the shadcn components in components/ui use it.
  const root = join(__dirname, '..');
  const misuse = /\b(?:text|bg|border|ring|fill|stroke|outline|decoration)-accent(?![\w-])/;
  const offenders = readdirSync(root, { recursive: true, encoding: 'utf8' })
    .filter((f) => /\.tsx?$/.test(f) && !f.startsWith(join('components', 'ui')))
    .flatMap((f) =>
      readFileSync(join(root, f), 'utf8')
        .split('\n')
        .flatMap((line, i) => (misuse.test(line) ? [`${f}:${String(i + 1)}`] : [])),
    );
  expect(offenders).toEqual([]);
});
