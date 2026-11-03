// The main window with a side-by-side view: every session of the view on screen at once.

import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { TerminalViewProps } from '@/terminal/TerminalView';
import { registerCorePanels } from '@/panels/core';
import { shownView, useWorkspace } from '@/stores/workspace';
import { defaultSettings } from '@/test/fixtures';
import { viewTabs } from '@/workspace/view';
import { AppShell } from './AppShell';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(() => Promise.resolve(null)) }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(() => Promise.resolve(() => undefined)) }));
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    minimize: vi.fn(() => Promise.resolve()),
    toggleMaximize: vi.fn(() => Promise.resolve()),
    close: vi.fn(() => Promise.resolve()),
    isMaximized: vi.fn(() => Promise.resolve(false)),
    onResized: vi.fn(() => Promise.resolve(() => undefined)),
    onCloseRequested: vi.fn(() => Promise.resolve(() => undefined)),
  }),
}));
vi.mock('@/terminal/TerminalView', () => ({
  TerminalView: (p: TerminalViewProps) => (
    <div data-testid={`term-${p.leafId}`} data-active={p.active} />
  ),
}));

const ws = () => useWorkspace.getState();
const leafOf = (tabId: string) => ws().tabs.find((t) => t.id === tabId)?.activeLeafId ?? '';
const term = (tabId: string) => screen.getByTestId(`term-${leafOf(tabId)}`);
const shell = () => (
  <AppShell settings={defaultSettings} appInfo={{ version: '0.1.0', platform: 'windows' }} />
);

beforeAll(() => {
  registerCorePanels();
});

let a = '';
let b = '';
beforeEach(() => {
  useWorkspace.setState({
    tabs: [],
    activeTabId: null,
    dormant: [],
    activeSpaceId: 'main',
    activeTabBySpace: {},
    views: {},
  });
  a = ws().openTab('cmd');
  b = ws().openTab('cmd');
  ws().openTab('cmd');
  ws().activateTab(a);
  ws().placeInView(b, a, 'right');
});

test('a shown view displays every session in it, each with its strip', () => {
  render(shell());
  expect(term(a).closest('.hidden')).toBeNull();
  expect(term(b).closest('.hidden')).toBeNull();
  expect(screen.getAllByRole('button', { name: /^Retirer .+ de la vue$/ })).toHaveLength(2);
  expect(term(b).dataset.active).toBe('true');
  expect(term(a).dataset.active).toBe('false');
});

test("the strip's × takes the session out of the view", () => {
  render(shell());
  const [, second] = screen.getAllByRole('button', { name: /^Retirer .+ de la vue$/ });
  if (!second) throw new Error('no strip');
  fireEvent.click(second);
  expect(shownView(ws())).toBeNull();
  expect(ws().tabs).toHaveLength(3);
  expect(term(b).closest('.hidden')).not.toBeNull();
});

test('a mouse down in another slot makes its session active', () => {
  render(shell());
  fireEvent.mouseDown(term(a));
  expect(ws().activeTabId).toBe(a);
  expect(shownView(ws())).not.toBeNull();
});

describe('resizing the view', () => {
  const area = new DOMRect(0, 0, 1000, 600);

  beforeEach(() => {
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: Element,
    ) {
      return this.hasAttribute('data-view-area') ? area : new DOMRect(0, 0, 0, 0);
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('a view of two has one separator between the sessions', () => {
    render(shell());
    expect(screen.getAllByRole('separator', { name: 'Séparation des sessions' })).toHaveLength(1);
  });

  test('dragging the separator resizes the sessions', () => {
    render(shell());
    const separator = screen.getByRole('separator', { name: 'Séparation des sessions' });
    fireEvent.pointerDown(separator, { clientX: 500, clientY: 300, pointerId: 1, button: 0 });
    fireEvent.pointerMove(window, { clientX: 700, clientY: 300, pointerId: 1 });
    fireEvent.pointerUp(window, { clientX: 700, clientY: 300, pointerId: 1 });
    const root = ws().views.main?.root;
    expect(root?.type === 'split' && root.sizes.map(Math.round)).toEqual([70, 30]);
  });
});

test('removing a session that is not the active one keeps the active one', async () => {
  const c = ws().tabs[2]?.id ?? '';
  ws().placeInView(c, b, 'right');
  expect(ws().activeTabId).toBe(c);
  render(shell());
  const [, second] = screen.getAllByRole('button', { name: /^Retirer .+ de la vue$/ });
  if (!second) throw new Error('no strip');
  await userEvent.click(second);
  const view = shownView(ws());
  expect(view && viewTabs(view)).toEqual([a, c]);
  expect(ws().activeTabId).toBe(c);
});
