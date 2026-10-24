import { Box } from 'lucide-react';
import { hasCommand } from '@/commands/registry';
import { useWorkspace } from '@/stores/workspace';
import { sanitizeSnapshot } from '@/workspace/sanitize';
import { leaves } from '@/workspace/tree';
import { registerCorePanels } from './core';
import { getPanelModule, listPanelModules, registerPanel, type PanelModule } from './registry';

const Nothing = () => null;

function testModule(over: Partial<PanelModule> = {}): PanelModule {
  return {
    id: 'test.thing',
    kind: 'thing',
    title: 'Chose',
    icon: Box,
    component: Nothing,
    ...over,
  };
}

beforeAll(() => {
  registerCorePanels();
});

test('registers, finds and unregisters a module', () => {
  const off = registerPanel(testModule());
  expect(getPanelModule('thing')?.id).toBe('test.thing');
  expect(listPanelModules().map((m) => m.kind)).toEqual(
    expect.arrayContaining(['terminal', 'ssh', 'sftp', 'thing']),
  );
  off();
  expect(getPanelModule('thing')).toBeUndefined();
});

test("a module's commands join the command registry while it is registered", () => {
  const off = registerPanel(
    testModule({
      commands: [{ id: 'thing.open', title: 'Ouvrir une chose', group: 'Panneaux', run: vi.fn() }],
    }),
  );
  expect(hasCommand('thing.open')).toBe(true);
  off();
  expect(hasCommand('thing.open')).toBe(false);
});

const leaf = (id: string, panel: unknown) => ({ type: 'leaf', id, panel });
const terminal = { kind: 'terminal', profileId: 'pwsh', cwd: null, title: null };

test('unknown kinds are dropped at restore', () => {
  const snap = sanitizeSnapshot({
    version: 1,
    activeTabId: 't1',
    tabs: [
      {
        id: 't1',
        activeLeafId: 'a',
        root: {
          type: 'split',
          id: 's',
          direction: 'row',
          sizes: [50, 50],
          children: [leaf('a', terminal), leaf('b', { kind: 'nope' })],
        },
      },
    ],
  });
  const tab = snap?.tabs[0];
  expect(tab && leaves(tab.root).map((l) => l.id)).toEqual(['a']);
});

test('a module can refuse to be saved', () => {
  const off = registerPanel(testModule({ serialize: () => null }));
  useWorkspace.setState({
    tabs: [
      {
        id: 't1',
        customTitle: null,
        color: null,
        spaceId: null,
        pinnedConnectionId: null,
        activeLeafId: 'a',
        root: {
          type: 'split',
          id: 's',
          direction: 'row',
          sizes: [50, 50],
          children: [leaf('a', terminal), leaf('b', { kind: 'thing' })] as never,
        },
      },
      {
        id: 't2',
        customTitle: null,
        color: null,
        spaceId: null,
        pinnedConnectionId: null,
        activeLeafId: 'c',
        root: leaf('c', { kind: 'thing' }) as never,
      },
    ],
    activeTabId: 't2',
  });
  const snap = useWorkspace.getState().snapshot();
  expect(snap.tabs.map((t) => t.id)).toEqual(['t1']);
  const first = snap.tabs[0];
  expect(first && leaves(first.root).map((l) => l.id)).toEqual(['a']);
  expect(snap.activeTabId).toBe('t1');
  off();
});
