import { useCallback, useRef, type Ref } from 'react';

/**
 * Once a menu closes, Radix gives the keyboard back to what had it when the menu opened (a
 * Rail row, a button). A choice that showed something taking the keyboard keeps it there
 * instead: the terminal of a session it opened, a field it started. That pane tries while
 * the menu still holds the focus (and takes it back), so the attempt is noted and honoured
 * once the menu is gone. Without such a choice (Escape), the focus goes back as before.
 *
 * Returns the ref to put on the menu's content and its `onCloseAutoFocus`.
 */
export function useHandedFocus<T extends HTMLElement>(
  ref: Ref<T> | undefined,
  onCloseAutoFocus: ((e: Event) => void) | undefined,
) {
  const attempt = useRef<HTMLElement | null>(null);
  const stop = useRef<(() => void) | null>(null);

  const contentRef = useCallback(
    (menu: T | null) => {
      setRef(ref, menu);
      stop.current?.();
      stop.current = null;
      if (!menu) return;
      attempt.current = null;
      // The menu keeps the focus while it is open: what tries to take it is the element the
      // focus was leaving for (or, once the menu stops holding it, the one that took it).
      const note = (to: EventTarget | null) => {
        if (to instanceof HTMLElement && !menu.contains(to)) attempt.current = to;
      };
      const onFocusOut = (e: FocusEvent) => {
        note(e.relatedTarget);
      };
      const onFocusIn = (e: FocusEvent) => {
        note(e.target);
      };
      const doc = menu.ownerDocument;
      menu.addEventListener('focusout', onFocusOut, true);
      doc.addEventListener('focusin', onFocusIn, true);
      stop.current = () => {
        menu.removeEventListener('focusout', onFocusOut, true);
        doc.removeEventListener('focusin', onFocusIn, true);
      };
    },
    [ref],
  );

  const onClose = (e: Event) => {
    onCloseAutoFocus?.(e);
    const target = attempt.current;
    attempt.current = null;
    if (e.defaultPrevented) return;
    const now = document.activeElement;
    if (now instanceof HTMLElement && now !== document.body) {
      // Something has the keyboard already (the menu is gone): it keeps it.
      e.preventDefault();
    } else if (target?.isConnected) {
      e.preventDefault();
      target.focus();
    }
  };

  return { ref: contentRef, onCloseAutoFocus: onClose };
}

function setRef<T>(ref: Ref<T> | undefined, value: T | null): void {
  if (typeof ref === 'function') ref(value);
  else if (ref) ref.current = value;
}
