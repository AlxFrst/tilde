import type { Tab } from '@/workspace/types';
import { isSeen, useAttention, watchAttention } from './attention';
import { tabsOnScreen, useWorkspace } from './workspace';

const tab = (id: string): Tab => ({
  id,
  customTitle: id,
  color: null,
  root: {
    type: 'leaf',
    id: `${id}-pane`,
    panel: { kind: 'terminal', profileId: 'pwsh', cwd: null, title: null },
  },
  activeLeafId: `${id}-pane`,
  spaceId: null,
  pinnedConnectionId: null,
});

const marked = () => Object.keys(useAttention.getState().marked).sort();
let stop: () => void = () => undefined;

beforeEach(() => {
  useWorkspace.setState({
    tabs: [tab('a'), tab('b'), tab('c')],
    activeTabId: 'a',
    activeSpaceId: 'main',
    views: {},
    viewsEnabled: true,
  });
  useAttention.setState({ marked: {}, windowFocused: true });
  stop = watchAttention();
});
afterEach(() => {
  stop();
});

describe('what is on screen', () => {
  test('the active session alone, without a view', () => {
    expect(tabsOnScreen(useWorkspace.getState())).toEqual(['a']);
  });

  test('every session of the view shown, side by side', () => {
    useWorkspace.setState({
      views: {
        main: {
          shown: true,
          root: {
            type: 'split',
            id: 's',
            direction: 'row',
            children: [
              { type: 'leaf', tabId: 'a' },
              { type: 'leaf', tabId: 'b' },
            ],
            sizes: [50, 50],
          },
        },
      },
    });
    expect(tabsOnScreen(useWorkspace.getState())).toEqual(['a', 'b']);
    // In the Quake console there is never a view.
    expect(tabsOnScreen({ ...useWorkspace.getState(), viewsEnabled: false })).toEqual(['a']);
  });

  test('nothing when no session is open', () => {
    useWorkspace.setState({ tabs: [], activeTabId: null });
    expect(tabsOnScreen(useWorkspace.getState())).toEqual([]);
  });
});

test('a session is seen only on screen and with the window focused', () => {
  expect(isSeen('a')).toBe(true);
  expect(isSeen('b')).toBe(false);
  useAttention.getState().setWindowFocused(false);
  expect(isSeen('a')).toBe(false);
});

test('a mark goes once its session is shown', () => {
  useAttention.getState().mark('b');
  useAttention.getState().mark('c');
  expect(marked()).toEqual(['b', 'c']);
  useWorkspace.setState({ activeTabId: 'b' });
  expect(marked()).toEqual(['c']);
});

test('a mark on the session on screen waits for the window to get the focus back', () => {
  useAttention.getState().setWindowFocused(false);
  useAttention.getState().mark('a');
  expect(marked()).toEqual(['a']);
  useAttention.getState().setWindowFocused(true);
  expect(marked()).toEqual([]);
});

test('a closed session loses its mark', () => {
  useAttention.getState().mark('c');
  useWorkspace.setState({ tabs: [tab('a'), tab('b')] });
  expect(marked()).toEqual([]);
});

test('once stopped, marks are left alone', () => {
  stop();
  useAttention.getState().mark('b');
  useWorkspace.setState({ activeTabId: 'b' });
  expect(marked()).toEqual(['b']);
});
