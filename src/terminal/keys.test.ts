import {
  compileBindings,
  DEFAULT_KEYBINDINGS,
  eventToBinding,
  formatBinding,
  matchShortcut,
  parseBinding,
  requiresModifier,
} from './keys';

const table = compileBindings(DEFAULT_KEYBINDINGS);

const ev = (e: Partial<KeyboardEvent>) => ({
  key: '',
  code: '',
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  metaKey: false,
  ...e,
});
const match = (e: ReturnType<typeof ev>) => matchShortcut(e, table, false);

test('matches by physical key code', () => {
  expect(match(ev({ code: 'KeyT', key: 'T', ctrlKey: true, shiftKey: true }))).toBe('tab.new');
  // AZERTY: the key labelled "+" sends code Equal; key differs but the shortcut matches.
  expect(match(ev({ code: 'Equal', key: '+', altKey: true, shiftKey: true }))).toBe(
    'pane.splitRight',
  );
  expect(match(ev({ code: 'Minus', key: '_', altKey: true, shiftKey: true }))).toBe(
    'pane.splitDown',
  );
});

test('letter shortcuts follow the printed letter (AZERTY)', () => {
  // AZERTY: the key printed "W" sends code KeyZ; the key printed "Z" sends code KeyW.
  expect(match(ev({ code: 'KeyZ', key: 'W', ctrlKey: true, shiftKey: true }))).toBe('tab.close');
  expect(match(ev({ code: 'KeyW', key: 'Z', ctrlKey: true, shiftKey: true }))).toBeNull();
  // Non-Latin layouts (e.g. Russian "Ц" on KeyW) fall back to the physical key.
  expect(match(ev({ code: 'KeyW', key: 'Ц', ctrlKey: true, shiftKey: true }))).toBe('tab.close');
});

test('modifiers must match exactly', () => {
  expect(match(ev({ code: 'KeyT', key: 't', ctrlKey: true }))).toBeNull();
  expect(
    match(ev({ code: 'KeyT', key: 'T', ctrlKey: true, shiftKey: true, altKey: true })),
  ).toBeNull();
});

test('falls back to the key when the physical code is missing', () => {
  // Remote desktop, automation tools and some IMEs deliver an empty `code`.
  expect(match(ev({ code: '', key: 'T', ctrlKey: true, shiftKey: true }))).toBe('tab.new');
  expect(match(ev({ code: '', key: '+', altKey: true, shiftKey: true }))).toBe('pane.splitRight');
  expect(match(ev({ code: 'Unidentified', key: '_', altKey: true, shiftKey: true }))).toBe(
    'pane.splitDown',
  );
  expect(match(ev({ code: '', key: 'ArrowUp', altKey: true }))).toBe('pane.focusUp');
});

test('falls back to the key when the physical code does not match', () => {
  // Numpad keys: the produced character still identifies the shortcut.
  expect(match(ev({ code: 'NumpadSubtract', key: '-', altKey: true, shiftKey: true }))).toBe(
    'pane.splitDown',
  );
  expect(match(ev({ code: 'NumpadAdd', key: '+', altKey: true, shiftKey: true }))).toBe(
    'pane.splitRight',
  );
  // Arrow keys reported as numpad keys (NumLock off).
  expect(match(ev({ code: 'Numpad4', key: 'ArrowLeft', altKey: true }))).toBe('pane.focusLeft');
  // An unrelated key never matches through its character.
  expect(match(ev({ code: 'Digit6', key: '6', altKey: true, shiftKey: true }))).toBeNull();
});

test('arrows and tab', () => {
  expect(match(ev({ code: 'ArrowLeft', key: 'ArrowLeft', altKey: true }))).toBe('pane.focusLeft');
  expect(match(ev({ code: 'Tab', key: 'Tab', ctrlKey: true }))).toBe('tab.next');
  expect(match(ev({ code: 'Tab', key: 'Tab', ctrlKey: true, shiftKey: true }))).toBe('tab.prev');
  expect(match(ev({ code: 'KeyF', key: 'F', ctrlKey: true, shiftKey: true }))).toBe(
    'terminal.search',
  );
});

test('parse/format roundtrip canonicalises modifier order', () => {
  const b = parseBinding('shift+alt+t');
  expect(b && formatBinding(b)).toBe('Alt+Shift+T');
  expect(formatBinding(parseBinding('Shift+Ctrl+Alt+F5') ?? fail())).toBe('Ctrl+Alt+Shift+F5');
  expect(formatBinding(parseBinding('Ctrl+`') ?? fail())).toBe('Ctrl+`');
  expect(formatBinding(parseBinding('Alt+arrowleft') ?? fail())).toBe('Alt+ArrowLeft');
  for (const b of Object.values(DEFAULT_KEYBINDINGS)) {
    expect(formatBinding(parseBinding(b) ?? fail())).toBe(b);
  }
});

test('rejects unknown keys', () => {
  for (const s of [
    '',
    'Ctrl+',
    'Ctrl+Truc',
    'Ctrl++',
    'Hyper+A',
    'Ctrl+A+B',
    'Ctrl+F25',
    'Ctrl+é',
  ]) {
    expect(parseBinding(s), s).toBeNull();
  }
});

test('requires a modifier except for function keys', () => {
  expect(requiresModifier(parseBinding('A') ?? fail())).toBe(true);
  expect(requiresModifier(parseBinding('Enter') ?? fail())).toBe(true);
  expect(requiresModifier(parseBinding('F11') ?? fail())).toBe(false);
});

test('eventToBinding records letters by character and symbols by physical key', () => {
  expect(eventToBinding(ev({ code: 'KeyZ', key: 'w', ctrlKey: true, shiftKey: true }), false)).toBe(
    'Ctrl+Shift+W',
  );
  // AZERTY: the ")" key is the physical Minus key.
  expect(eventToBinding(ev({ code: 'Minus', key: ')', altKey: true, shiftKey: true }), false)).toBe(
    'Alt+Shift+-',
  );
  // AZERTY digits: "&" is Digit1.
  expect(eventToBinding(ev({ code: 'Digit1', key: '&', ctrlKey: true }), false)).toBe('Ctrl+1');
  expect(eventToBinding(ev({ code: 'Backquote', key: '²', ctrlKey: true }), false)).toBe('Ctrl+`');
  expect(eventToBinding(ev({ code: 'F5', key: 'F5' }), false)).toBe('F5');
  // Modifier keys alone are not a shortcut yet.
  expect(eventToBinding(ev({ code: 'ShiftLeft', key: 'Shift', shiftKey: true }), false)).toBeNull();
  // On macOS, ⌘ is recorded as Ctrl (and Ctrl itself is not a Tilde modifier).
  expect(eventToBinding(ev({ code: 'KeyK', key: 'k', metaKey: true }), true)).toBe('Ctrl+K');
});

test('an unbound command no longer matches', () => {
  const t = compileBindings({ ...DEFAULT_KEYBINDINGS, 'tab.new': null, 'tab.close': 'Ctrl+Alt+W' });
  const e = ev({ code: 'KeyT', key: 'T', ctrlKey: true, shiftKey: true });
  expect(matchShortcut(e, t, false)).toBeNull();
  expect(matchShortcut(ev({ code: 'KeyW', key: 'W', ctrlKey: true, altKey: true }), t, false)).toBe(
    'tab.close',
  );
  expect(
    matchShortcut(ev({ code: 'KeyW', key: 'W', ctrlKey: true, shiftKey: true }), t, false),
  ).toBeNull();
});

function fail(): never {
  throw new Error('unexpected null');
}
