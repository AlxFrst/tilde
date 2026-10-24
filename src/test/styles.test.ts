import { readFileSync } from 'node:fs';
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
