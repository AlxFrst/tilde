import { tags } from '@lezer/highlight';
import { builtinThemes, getTheme, type ThemeDefinition } from '@/themes';
import { editorTheme, highlightStyleFor } from './editorTheme';

const font = { family: 'JetBrains Mono Variable', size: 14 };

test.each(builtinThemes.map((t) => [t.id, t] as const))(
  'builds an extension from any builtin theme (%s)',
  (_id, theme) => {
    expect(() => editorTheme(theme, font)).not.toThrow();
  },
);

test("keywords use the theme's magenta, comments its bright black", () => {
  const nord = getTheme('nord') as ThemeDefinition;
  const specs = highlightStyleFor(nord).specs;
  const color = (tag: unknown): unknown =>
    specs.find((s) => (Array.isArray(s.tag) ? s.tag.includes(tag) : s.tag === tag))?.color;
  expect(color(tags.keyword)).toBe(nord.terminal.magenta);
  expect(color(tags.comment)).toBe(nord.terminal.brightBlack);
  expect(color(tags.string)).toBe(nord.terminal.green);
});
