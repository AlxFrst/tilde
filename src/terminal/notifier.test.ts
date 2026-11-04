import { useAttention } from '@/stores/attention';
import { useWorkspace } from '@/stores/workspace';
import { defaultSettings } from '@/test/fixtures';
import type { Panel, Tab } from '@/workspace/types';
import { NOTIFY_INTERVAL_MS, createSessionNotifier } from './notifier';

vi.mock('@/ipc/notify', () => ({
  notifyDesktop: vi.fn(() => Promise.resolve()),
  requestAttention: vi.fn(),
}));
const { notifyDesktop, requestAttention } = await import('@/ipc/notify');

const tab = (id: string, customTitle: string | null, panel?: Panel): Tab => ({
  id,
  customTitle,
  color: null,
  root: {
    type: 'leaf',
    id: `${id}-pane`,
    panel: panel ?? { kind: 'terminal', profileId: 'pwsh', cwd: null, title: null },
  },
  activeLeafId: `${id}-pane`,
  spaceId: null,
  pinnedConnectionId: null,
});

let clock = 0;
let prefs = { ...defaultSettings.terminal.notifications };
const notifier = (tabId: string) =>
  createSessionNotifier(
    () => tabId,
    () => prefs,
    () => clock,
  );
const marked = () => Object.keys(useAttention.getState().marked);

beforeEach(() => {
  vi.clearAllMocks();
  clock = 1_000_000;
  prefs = { ...defaultSettings.terminal.notifications };
  useWorkspace.setState({
    tabs: [tab('shown', 'editing'), tab('build', 'build box')],
    activeTabId: 'shown',
    activeSpaceId: 'main',
    views: {},
    viewsEnabled: true,
  });
  useAttention.setState({ marked: {}, windowFocused: true });
});

test('a long command ending in another session notifies with its name and marks the Rail', () => {
  const n = notifier('build');
  n.shellMark('C');
  clock += 65_000;
  n.shellMark('D;0');
  expect(notifyDesktop).toHaveBeenCalledWith('build box', 'Commande terminée en 1 min 5 s');
  expect(marked()).toEqual(['build']);
  // The window has the focus: no need to flash it.
  expect(requestAttention).not.toHaveBeenCalled();
});

test('a failed command says its code', () => {
  const n = notifier('build');
  n.shellMark('C');
  clock += 12_000;
  n.shellMark('D;2');
  expect(notifyDesktop).toHaveBeenCalledWith('build box', 'Commande échouée (code 2) en 12 s');
});

test('VS Code’s marks (OSC 633) work the same', () => {
  const n = notifier('build');
  n.shellMark('C');
  clock += 30_000;
  n.shellMark('D');
  expect(notifyDesktop).toHaveBeenCalledWith('build box', 'Commande terminée en 30 s');
});

test('a command shorter than the minimum, or a prompt without a command, says nothing', () => {
  const n = notifier('build');
  n.shellMark('D;0');
  n.shellMark('C');
  clock += 9_000;
  n.shellMark('D;0');
  expect(notifyDesktop).not.toHaveBeenCalled();
  expect(marked()).toEqual([]);
});

test('in the session the user is looking at: nothing at all', () => {
  const n = notifier('shown');
  n.shellMark('C');
  clock += 60_000;
  n.shellMark('D;0');
  n.osc9('done');
  n.bell();
  expect(notifyDesktop).not.toHaveBeenCalled();
  expect(requestAttention).not.toHaveBeenCalled();
  expect(marked()).toEqual([]);
});

test('a session shown side by side is looked at too', () => {
  useWorkspace.setState({
    views: {
      main: {
        shown: true,
        root: {
          type: 'split',
          id: 'v',
          direction: 'row',
          children: [
            { type: 'leaf', tabId: 'shown' },
            { type: 'leaf', tabId: 'build' },
          ],
          sizes: [50, 50],
        },
      },
    },
  });
  notifier('build').osc9('done');
  expect(notifyDesktop).not.toHaveBeenCalled();
});

test('with Tilde in the background, even the session on screen notifies and the taskbar flashes', () => {
  useAttention.setState({ windowFocused: false });
  notifier('shown').osc777('notify;Backup;done');
  expect(notifyDesktop).toHaveBeenCalledWith('editing', 'Backup — done');
  expect(requestAttention).toHaveBeenCalledTimes(1);
  expect(marked()).toEqual(['shown']);
});

test('a program spamming the bell or OSC 9 gets one notification every few seconds', () => {
  useAttention.setState({ windowFocused: false });
  const n = notifier('build');
  for (let i = 0; i < 50; i++) {
    n.bell();
    n.osc9(`step ${String(i)}`);
    clock += 10;
  }
  expect(notifyDesktop).toHaveBeenCalledTimes(1);
  expect(notifyDesktop).toHaveBeenCalledWith('build box', 'Signal sonore');
  expect(requestAttention).toHaveBeenCalledTimes(1);
  clock += NOTIFY_INTERVAL_MS;
  n.osc9('finally');
  expect(notifyDesktop).toHaveBeenCalledTimes(2);
  expect(notifyDesktop).toHaveBeenLastCalledWith('build box', 'finally');
  // Each session has its own allowance.
  notifier('shown').osc9('elsewhere');
  expect(notifyDesktop).toHaveBeenCalledTimes(3);
});

test('ConEmu progress (OSC 9;4) is not a message', () => {
  notifier('build').osc9('4;1;50');
  expect(notifyDesktop).not.toHaveBeenCalled();
  expect(marked()).toEqual([]);
});

test('the bell marks the Rail without notifying when the bell setting is off', () => {
  prefs = { ...prefs, onBell: false };
  notifier('build').bell();
  expect(notifyDesktop).not.toHaveBeenCalled();
  expect(marked()).toEqual(['build']);
});

test('with notifications off, only the Rail is marked', () => {
  prefs = { ...prefs, enabled: false };
  useAttention.setState({ windowFocused: false });
  notifier('build').osc9('done');
  expect(notifyDesktop).not.toHaveBeenCalled();
  expect(requestAttention).not.toHaveBeenCalled();
  expect(marked()).toEqual(['build']);
});

test('the minimum duration follows the setting', () => {
  prefs = { ...prefs, minDurationSecs: 0 };
  const n = notifier('build');
  n.shellMark('C');
  clock += 500;
  n.shellMark('D;0');
  expect(notifyDesktop).toHaveBeenCalledTimes(1);
});

test('a new shell forgets the command the old one was running', () => {
  const n = notifier('build');
  n.shellMark('C');
  n.reset();
  clock += 60_000;
  n.shellMark('D;0');
  expect(notifyDesktop).not.toHaveBeenCalled();
});

test('a title set by the remote shell is cleaned and cut short', () => {
  const title = `\u001b[31m${'x'.repeat(200)}`;
  useWorkspace.setState({
    tabs: [
      tab('shown', null),
      tab('remote', null, {
        kind: 'ssh',
        target: 'demo-server',
        connectionId: null,
        cwd: null,
        title,
      }),
    ],
  });
  notifier('remote').osc9('done');
  const [shownTitle] = vi.mocked(notifyDesktop).mock.calls[0] ?? [];
  expect(shownTitle).toMatch(/^\[31mx+…$/);
  expect(Array.from(shownTitle ?? '')).toHaveLength(80);
});
