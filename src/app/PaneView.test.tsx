import { act, fireEvent, render, screen } from '@testing-library/react';
import { useEffect } from 'react';
import { useWorkspace } from '@/stores/workspace';
import type { TerminalViewProps } from '@/terminal/TerminalView';
import { leaves } from '@/workspace/tree';
import { registerCorePanels } from '@/panels/core';
import { registerPanel } from '@/panels/registry';
import { Box } from 'lucide-react';
import { PaneView } from './PaneView';

const mounts = vi.hoisted(() => new Map<string, number>());

vi.mock('@/terminal/TerminalView', () => ({
  TerminalView: (p: TerminalViewProps) => {
    useEffect(() => {
      mounts.set(p.leafId, (mounts.get(p.leafId) ?? 0) + 1);
    }, [p.leafId]);
    return (
      <div data-testid={`term-${p.leafId}`} data-active={p.active}>
        <button
          type="button"
          onClick={() => {
            p.onExit(0);
          }}
        >
          exit0-{p.leafId}
        </button>
        <button
          type="button"
          onClick={() => {
            p.onExit(3);
          }}
        >
          exit3-{p.leafId}
        </button>
        <button
          type="button"
          onClick={() => {
            p.onCwd('/srv');
          }}
        >
          cwd-{p.leafId}
        </button>
      </div>
    );
  },
}));

vi.mock('@/panels/monitor/ServerStatusBar', () => ({
  ServerStatusBar: ({ leafId }: { leafId: string }) => <div data-testid={`strip-${leafId}`} />,
}));

const ws = () => useWorkspace.getState();
const tab = () => {
  const t = ws().tabs[0];
  if (!t) throw new Error('no tab');
  return t;
};

function Live() {
  const t = useWorkspace((s) => s.tabs[0]);
  return t ? <PaneView tab={t} visible /> : null;
}

beforeAll(() => {
  registerCorePanels();
});

beforeEach(() => {
  mounts.clear();
  useWorkspace.setState({ tabs: [], activeTabId: null });
  ws().openTab('cmd');
  ws().splitActive('row');
});

test('renders one TerminalView per leaf', () => {
  render(<Live />);
  for (const l of leaves(tab().root)) {
    expect(screen.getByTestId(`term-${l.id}`)).toBeInTheDocument();
  }
});

test('splitting keeps existing terminals mounted', () => {
  render(<Live />);
  const before = leaves(tab().root).map((l) => l.id);
  act(() => {
    ws().splitActive('column');
  });
  act(() => {
    ws().focusLeaf(tab().id, before[0] ?? '');
    ws().splitActive('column');
  });
  expect(leaves(tab().root)).toHaveLength(4);
  for (const id of before) expect(mounts.get(id)).toBe(1);
});

test('closing a pane keeps the others mounted', () => {
  render(<Live />);
  const [first, second] = leaves(tab().root);
  if (!first || !second) throw new Error();
  act(() => {
    ws().closeLeaf(tab().id, second.id);
  });
  expect(mounts.get(first.id)).toBe(1);
});

test('panes are positioned from the layout sizes', () => {
  render(<Live />);
  const [first, second] = leaves(tab().root);
  if (!first || !second) throw new Error();
  const box = (id: string) => screen.getByTestId(`term-${id}`).parentElement as HTMLElement;
  expect(box(first.id).style.left).toBe('0%');
  expect(box(first.id).style.width).toBe('50%');
  expect(box(second.id).style.left).toBe('50%');
});

test('clicking a pane focuses it', () => {
  const [first] = leaves(tab().root);
  if (!first) throw new Error();
  render(<Live />);
  fireEvent.mouseDown(screen.getByTestId(`term-${first.id}`));
  expect(tab().activeLeafId).toBe(first.id);
});

test('pane closes on exit code 0 and shows the code otherwise', () => {
  const [first, second] = leaves(tab().root);
  if (!first || !second) throw new Error();
  render(<Live />);
  fireEvent.click(screen.getByText(`exit3-${first.id}`));
  expect(leaves(tab().root)).toHaveLength(2);
  fireEvent.click(screen.getByText(`exit0-${second.id}`));
  expect(leaves(tab().root).map((l) => l.id)).toEqual([first.id]);
});

test('cwd reported by the shell is stored on the panel', () => {
  const [first] = leaves(tab().root);
  if (!first) throw new Error();
  render(<Live />);
  fireEvent.click(screen.getByText(`cwd-${first.id}`));
  expect(leaves(tab().root)[0]?.panel.cwd).toBe('/srv');
});

test('renders a pane through its module', () => {
  const off = registerPanel<{ kind: 'thing'; label: string }>({
    id: 'test.thing',
    kind: 'thing',
    title: 'Chose',
    icon: Box,
    component: ({ state }) => <div>chose-{state.label}</div>,
  });
  useWorkspace.setState({
    tabs: [
      {
        id: 't1',
        customTitle: null,
        color: null,
        activeLeafId: 'x',
        root: { type: 'leaf', id: 'x', panel: { kind: 'thing', label: 'ok' } } as never,
      },
    ],
    activeTabId: 't1',
  });
  render(<Live />);
  expect(screen.getByText('chose-ok')).toBeInTheDocument();
  off();
});

test('a pane that crashes is contained; the others keep running', () => {
  const off = registerPanel<{ kind: 'boom' }>({
    id: 'test.boom',
    kind: 'boom',
    title: 'Boum',
    icon: Box,
    component: () => {
      throw new Error('kaboom');
    },
  });
  const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  useWorkspace.setState({
    tabs: [
      {
        id: 't1',
        customTitle: null,
        color: null,
        activeLeafId: 'a',
        root: {
          type: 'split',
          id: 's',
          direction: 'row',
          sizes: [50, 50],
          children: [
            {
              type: 'leaf',
              id: 'a',
              panel: { kind: 'terminal', profileId: 'pwsh', cwd: null, title: null },
            },
            { type: 'leaf', id: 'b', panel: { kind: 'boom' } },
          ],
        } as never,
      },
    ],
    activeTabId: 't1',
  });
  render(<Live />);
  expect(screen.getByTestId('term-a')).toBeInTheDocument();
  expect(screen.getByRole('alert')).toHaveTextContent(/kaboom/);
  spy.mockRestore();
  off();
});

test('a clean exit keeps an SSH pane open while an editor linked to it has unsaved changes', async () => {
  const { useEditors } = await import('@/stores/editors');
  useWorkspace.setState({
    tabs: [
      {
        id: 't1',
        customTitle: null,
        color: null,
        activeLeafId: 'a',
        root: {
          type: 'split',
          id: 's',
          direction: 'row',
          sizes: [50, 50],
          children: [
            {
              type: 'leaf',
              id: 'a',
              panel: { kind: 'ssh', target: 'prod', connectionId: null, cwd: null, title: null },
            },
            {
              type: 'leaf',
              id: 'ed',
              panel: {
                kind: 'editor',
                source: { kind: 'remote', linkedLeafId: 'a', path: '/etc/x' },
                cwd: null,
                title: null,
              },
            },
          ],
        },
      },
    ],
    activeTabId: 't1',
  });
  useEditors.setState({ docs: { ed: { name: 'x', dirty: true, text: 'y' } } });
  render(<Live />);
  fireEvent.click(screen.getByText('exit0-a'));
  expect(leaves(tab().root).map((l) => l.id)).toContain('a');
  useEditors.setState({ docs: {} });
});

test('ssh panes get the server status strip, local terminals do not', () => {
  ws().openSshTab('prod');
  const sshTab = ws().tabs.at(-1);
  if (!sshTab) throw new Error('no tab');
  render(<PaneView tab={sshTab} visible />);
  expect(screen.getByTestId(`strip-${sshTab.activeLeafId}`)).toBeInTheDocument();
  render(<Live />);
  for (const l of leaves(tab().root)) expect(screen.queryByTestId(`strip-${l.id}`)).toBeNull();
});
