import { MAIN_SPACE } from '@/connections/spaces';
import type { ConnectionsFile } from '@/ipc/connections';
import { registerCorePanels } from '@/panels/core';
import { blankConnection, useConnections } from '@/stores/connections';
import { useWorkspace } from '@/stores/workspace';
import { defaultSpaceResolver, setSpaceResolver, spaceOfTab } from '@/workspace/spaces';
import { startSpaceSync } from './spaceSync';

const pro = { id: 'pro', name: 'Pro', color: null, icon: null };
const c1 = blankConnection({ id: 'c1', name: 'prod', host: 'prod', spaceId: 'pro' });
const file = (extra: Partial<ConnectionsFile>): ConnectionsFile => ({
  version: 1,
  spaces: [MAIN_SPACE, pro],
  folders: [],
  connections: [c1],
  recents: [],
  ...extra,
});

beforeAll(() => {
  registerCorePanels();
});
afterEach(() => {
  setSpaceResolver(defaultSpaceResolver);
});

test('sessions follow connections.json as it changes', () => {
  useConnections.setState({ file: file({}) });
  useWorkspace.setState({
    tabs: [],
    activeTabId: null,
    activeSpaceId: 'main',
    activeTabBySpace: {},
  });
  const stop = startSpaceSync();
  const t = useWorkspace.getState().openPinned('c1', 'prod', 'pro');
  expect(useWorkspace.getState().activeSpaceId).toBe('pro');

  // The connection moves to Principal: its session follows, and stays shown.
  useConnections.setState({ file: file({ connections: [{ ...c1, spaceId: 'main' }] }) });
  const tab = useWorkspace.getState().tabs.find((x) => x.id === t);
  expect(tab && spaceOfTab(tab)).toBe('main');
  expect(useWorkspace.getState().activeSpaceId).toBe('main');

  // The space shown is deleted: back to the first one.
  useConnections.setState({ file: file({ spaces: [MAIN_SPACE, pro] }) });
  useWorkspace.getState().switchSpace('pro');
  useConnections.setState({ file: file({ spaces: [MAIN_SPACE] }) });
  expect(useWorkspace.getState().activeSpaceId).toBe('main');
  stop();
});
