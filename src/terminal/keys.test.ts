import { matchShortcut } from './keys';

const ev = (e: Partial<KeyboardEvent>) => ({
  key: '',
  code: '',
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  metaKey: false,
  ...e,
});

test('matches by physical key code', () => {
  expect(matchShortcut(ev({ code: 'KeyT', key: 'T', ctrlKey: true, shiftKey: true }))).toBe(
    'tab.new',
  );
  // AZERTY: the key labelled "+" sends code Equal; key differs but the shortcut matches.
  expect(matchShortcut(ev({ code: 'Equal', key: '+', altKey: true, shiftKey: true }))).toBe(
    'pane.splitRight',
  );
  expect(matchShortcut(ev({ code: 'Minus', key: '_', altKey: true, shiftKey: true }))).toBe(
    'pane.splitDown',
  );
});

test('modifiers must match exactly', () => {
  expect(matchShortcut(ev({ code: 'KeyT', key: 't', ctrlKey: true }))).toBeNull();
  expect(
    matchShortcut(ev({ code: 'KeyT', key: 'T', ctrlKey: true, shiftKey: true, altKey: true })),
  ).toBeNull();
});

test('arrows and tab', () => {
  expect(matchShortcut(ev({ code: 'ArrowLeft', key: 'ArrowLeft', altKey: true }))).toBe(
    'pane.focusLeft',
  );
  expect(matchShortcut(ev({ code: 'Tab', key: 'Tab', ctrlKey: true }))).toBe('tab.next');
  expect(matchShortcut(ev({ code: 'Tab', key: 'Tab', ctrlKey: true, shiftKey: true }))).toBe(
    'tab.prev',
  );
  expect(matchShortcut(ev({ code: 'KeyF', key: 'F', ctrlKey: true, shiftKey: true }))).toBe(
    'terminal.search',
  );
});
