import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ThemeError } from '../parse';
import { importTheme, slugify } from './index';

const fixture = (name: string) => readFileSync(join(__dirname, 'fixtures', name), 'utf8');

test('imports an itermcolors file', () => {
  const { themes } = importTheme('Dracula.itermcolors', fixture('Dracula.itermcolors'));
  expect(themes).toHaveLength(1);
  const [t] = themes;
  expect(t?.id).toBe('dracula');
  expect(t?.name).toBe('Dracula');
  expect(t?.kind).toBe('dark');
  expect(t?.terminal.red).toBe('#FF5555');
  expect(t?.terminal.background).toBe('#282A36');
  expect(t?.terminal.selectionBackground).toBe('#44475A');
  expect(t?.ui.bg).toBe('#282A36');
});

test('imports a Windows Terminal scheme', () => {
  const { themes } = importTheme('campbell.json', fixture('wt-scheme.json'));
  expect(themes.map((t) => t.name)).toEqual(['Campbell']);
  expect(themes[0]?.terminal.magenta).toBe('#881798');
  expect(themes[0]?.terminal.cursor).toBe('#FFFFFF');
});

test('imports every scheme of a Windows Terminal settings.json with comments', () => {
  const { themes, warnings } = importTheme('settings.json', fixture('wt-settings.json'));
  expect(themes.map((t) => t.id)).toEqual(['one-half-dark', 'one-half-light']);
  expect(themes.map((t) => t.kind)).toEqual(['dark', 'light']);
  expect(warnings).toHaveLength(1);
  expect(warnings[0]).toMatch(/Broken/);
});

test('imports base16 yaml', () => {
  const { themes } = importTheme('base16-ocean.yaml', fixture('base16-ocean.yaml'));
  const [t] = themes;
  expect(t?.name).toBe('Ocean');
  expect(t?.terminal.background).toBe('#2B303B');
  expect(t?.terminal.blue).toBe('#8FA1B3');
  expect(t?.terminal.brightBlack).toBe('#65737E');
  expect(t?.terminal.selectionBackground).toBe('#4F5B6660');
});

test('detects the format from the content when the extension says nothing', () => {
  expect(importTheme('theme.txt', fixture('base16-ocean.yaml')).themes[0]?.name).toBe('Ocean');
  expect(importTheme('x', fixture('wt-scheme.json')).themes[0]?.name).toBe('Campbell');
});

test.each([
  ['broken.itermcolors', '<plist><dict><key>Ansi 0 Color</key>'],
  [
    'entity.itermcolors',
    '<?xml version="1.0"?><!DOCTYPE plist [<!ENTITY x "y">]><plist><dict></dict></plist>',
  ],
  ['empty.itermcolors', '<?xml version="1.0"?><plist version="1.0"><dict></dict></plist>'],
  [
    'range.itermcolors',
    fixture('Dracula.itermcolors').replace(/(<key>Red Component<\/key>\s*<real>)[^<]*/, '$1nope'),
  ],
  ['nobase.yaml', 'scheme: "X"\nauthor: "Y"\n'],
  ['nocolors.json', '{ "name": "X" }'],
  ['bad.json', '{ "name": '],
  ['huge.json', 'x'.repeat(2 * 1024 * 1024)],
  ['random.bin', 'hello world'],
])('rejects_hostile_or_broken_files (%s)', (name, text) => {
  expect(() => importTheme(name, text)).toThrow(ThemeError);
});

test('slugify produces safe ids', () => {
  expect(slugify('../Nord Ⅱ')).toBe('nord-ii');
  expect(slugify('Rosé Pine')).toBe('rose-pine');
  expect(slugify('../..')).toBe('theme');
  expect(slugify('')).toBe('theme');
  expect(slugify('A'.repeat(100))).toHaveLength(64);
  for (const s of ['a/b', 'a\\b', 'C:\\x', '...', '  ']) expect(slugify(s)).toMatch(/^[a-z0-9-]+$/);
});
