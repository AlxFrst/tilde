import { renderHook } from '@testing-library/react';
import { registerCommands } from '@/commands/registry';
import { useShortcuts } from './useShortcuts';

const press = (target: EventTarget, code: string, key: string) => {
  target.dispatchEvent(
    new KeyboardEvent('keydown', {
      code,
      key,
      ctrlKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    }),
  );
};

test('app shortcuts are ignored while typing in a field, except the palette', () => {
  const newTab = vi.fn();
  const palette = vi.fn();
  const off = registerCommands([
    { id: 'tab.new', title: 'Nouvel onglet', group: 'Onglets', run: newTab },
    { id: 'palette.toggle', title: 'Palette', group: 'Application', run: palette },
  ]);
  renderHook(() => {
    useShortcuts();
  });
  const input = document.createElement('input');
  document.body.append(input);

  press(input, 'KeyT', 'T');
  expect(newTab).not.toHaveBeenCalled();
  press(input, 'KeyP', 'P');
  expect(palette).toHaveBeenCalledTimes(1);

  press(document.body, 'KeyT', 'T');
  expect(newTab).toHaveBeenCalledTimes(1);

  // The terminal's hidden textarea is not a form field: shortcuts work there.
  const xterm = document.createElement('div');
  xterm.className = 'xterm';
  const helper = document.createElement('textarea');
  xterm.append(helper);
  document.body.append(xterm);
  press(helper, 'KeyT', 'T');
  expect(newTab).toHaveBeenCalledTimes(2);
  off();
  input.remove();
  xterm.remove();
});
