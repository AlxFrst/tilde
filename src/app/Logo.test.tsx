import { render } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Logo } from './Logo';

test('the in-app mark is the app icon, with ids unique per instance', () => {
  const { container } = render(
    <>
      <Logo />
      <Logo />
    </>,
  );
  const ids = [...container.querySelectorAll('linearGradient')].map((g) => g.id);
  expect(ids).toHaveLength(2);
  expect(new Set(ids).size).toBe(2);
  // Same drawing as src-tauri/icons/icon.svg: tile, tilde, then the teal cursor.
  const icon = readFileSync(join(__dirname, '../../src-tauri/icons/icon.svg'), 'utf8');
  const cursor = container.querySelector('rect[fill="#5eead4"]');
  expect(cursor?.getAttribute('x')).toBe('680');
  expect(icon).toContain('<rect x="680" y="384" width="140" height="256" rx="18" fill="#5eead4"/>');
});
