import { useEffect } from 'react';
import { hasCommand, runCommand } from '@/commands/registry';
import { useKeybindings } from '@/stores/keybindings';
import { useUi } from '@/stores/ui';
import { matchShortcut } from '@/terminal/keys';

/**
 * True when keys belong to what the user is typing in (a form field, a dialog), not to
 * the app. The terminal's hidden textarea is not a field: shortcuts work in terminals.
 */
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement) || target.closest('.xterm')) return false;
  return (
    target.isContentEditable ||
    ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) ||
    target.closest('[role="dialog"]') !== null
  );
}

/**
 * Runs the command bound to a key (through the command registry). Listens in the
 * capture phase so shortcuts win over the focused terminal. While typing in a field or a
 * dialog only the palette toggle passes.
 */
export function useShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (useUi.getState().recordingShortcut) return;
      const command = matchShortcut(e, useKeybindings.getState().table);
      if (!command) return;
      if (!hasCommand(command)) return;
      if (command !== 'palette.toggle' && isTyping(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
      if (!e.repeat) runCommand(command);
    };
    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => {
      window.removeEventListener('keydown', onKeyDown, { capture: true });
    };
  }, []);
}
