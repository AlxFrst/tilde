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

test('letter shortcuts follow the printed letter (AZERTY)', () => {
  // AZERTY: the key printed "W" sends code KeyZ; the key printed "Z" sends code KeyW.
  expect(matchShortcut(ev({ code: 'KeyZ', key: 'W', ctrlKey: true, shiftKey: true }))).toBe(
    'tab.close',
  );
  expect(matchShortcut(ev({ code: 'KeyW', key: 'Z', ctrlKey: true, shiftKey: true }))).toBeNull();
  // Non-Latin layouts (e.g. Russian "Ц" on KeyW) fall back to the physical key.
  expect(matchShortcut(ev({ code: 'KeyW', key: 'Ц', ctrlKey: true, shiftKey: true }))).toBe(
    'tab.close',
  );
});

test('modifiers must match exactly', () => {
  expect(matchShortcut(ev({ code: 'KeyT', key: 't', ctrlKey: true }))).toBeNull();
  expect(
    matchShortcut(ev({ code: 'KeyT', key: 'T', ctrlKey: true, shiftKey: true, altKey: true })),
  ).toBeNull();
});

test('falls back to the key when the physical code is missing', () => {
  // Remote desktop, automation tools and some IMEs deliver an empty `code`.
  expect(matchShortcut(ev({ code: '', key: 'T', ctrlKey: true, shiftKey: true }))).toBe('tab.new');
  expect(matchShortcut(ev({ code: '', key: '+', altKey: true, shiftKey: true }))).toBe(
    'pane.splitRight',
  );
  expect(matchShortcut(ev({ code: 'Unidentified', key: '_', altKey: true, shiftKey: true }))).toBe(
    'pane.splitDown',
  );
  expect(matchShortcut(ev({ code: '', key: 'ArrowUp', altKey: true }))).toBe('pane.focusUp');
});

test('falls back to the key when the physical code does not match', () => {
  // Numpad keys: the produced character still identifies the shortcut.
  expect(
    matchShortcut(ev({ code: 'NumpadSubtract', key: '-', altKey: true, shiftKey: true })),
  ).toBe('pane.splitDown');
  expect(matchShortcut(ev({ code: 'NumpadAdd', key: '+', altKey: true, shiftKey: true }))).toBe(
    'pane.splitRight',
  );
  // Arrow keys reported as numpad keys (NumLock off).
  expect(matchShortcut(ev({ code: 'Numpad4', key: 'ArrowLeft', altKey: true }))).toBe(
    'pane.focusLeft',
  );
  // An unrelated key never matches through its character.
  expect(matchShortcut(ev({ code: 'Digit6', key: '6', altKey: true, shiftKey: true }))).toBeNull();
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
