// A menu gives the keyboard back to what had it when it opened, unless its choice handed it
// to something else: « Ouvrir une autre session » from the Rail left the new session's
// terminal without the keyboard, which went back to the Rail's row.

import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect, useRef, useState } from 'react';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from './context-menu';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './dropdown-menu';

/** A terminal: it takes the keyboard when it is shown, as a session's pane does. */
function Pane({ shown }: { shown: boolean }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (shown) ref.current?.focus();
  }, [shown]);
  return <textarea ref={ref} />;
}

// An open menu hides the rest of the page from roles (aria-hidden): found by its tag.
const pane = () => document.querySelector('textarea');

/** Lets the menu's focus return (a timeout after it closes) happen. */
const settle = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 10));
  });

function WithContextMenu() {
  const [shown, setShown] = useState(false);
  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <button type="button">row</button>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem
            onSelect={() => {
              setShown(true);
            }}
          >
            open
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      <Pane shown={shown} />
    </>
  );
}

test('a context-menu choice that shows a pane leaves it the keyboard', async () => {
  const user = userEvent.setup();
  render(<WithContextMenu />);
  const row = screen.getByRole('button', { name: 'row' });
  row.focus();
  await user.pointer({ keys: '[MouseRight]', target: row });
  await user.click(screen.getByRole('menuitem', { name: 'open' }));
  await settle();
  expect(pane()).toHaveFocus();
});

test('a context menu closed without a choice gives the keyboard back', async () => {
  const user = userEvent.setup();
  render(<WithContextMenu />);
  const row = screen.getByRole('button', { name: 'row' });
  row.focus();
  await user.pointer({ keys: '[MouseRight]', target: row });
  await user.keyboard('{Escape}');
  await settle();
  expect(row).toHaveFocus();
});

test('a dropdown choice that shows a pane leaves it the keyboard', async () => {
  function WithDropdown() {
    const [shown, setShown] = useState(false);
    return (
      <>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button">more</button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem
              onSelect={() => {
                setShown(true);
              }}
            >
              open
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Pane shown={shown} />
      </>
    );
  }
  const user = userEvent.setup();
  render(<WithDropdown />);
  await user.click(screen.getByRole('button', { name: 'more' }));
  await user.click(screen.getByRole('menuitem', { name: 'open' }));
  await settle();
  expect(pane()).toHaveFocus();
});
