import { registerCorePanels } from '@/panels/core';
import type { LayoutNode, Tab } from '@/workspace/types';
import { paneLabel, sessionTitle, type LabelNames } from './paneLabel';

beforeAll(() => {
  registerCorePanels();
});

const names: LabelNames = {
  connectionName: (id) => (id === 'c1' ? 'demo-server' : null),
  profileName: (id) => (id === 'pwsh' ? 'PowerShell' : null),
};
const ssh = (id: string, connectionId: string | null = 'c1'): LayoutNode => ({
  type: 'leaf',
  id,
  panel: { kind: 'ssh', target: 'demo', connectionId, cwd: '/var/www', title: 'osc title' },
});
const term = (id: string): LayoutNode => ({
  type: 'leaf',
  id,
  panel: { kind: 'terminal', profileId: 'pwsh', cwd: null, title: null },
});
const tab = (children: LayoutNode[], customTitle: string | null = null): Tab => ({
  id: 't',
  customTitle,
  color: null,
  activeLeafId: 'a',
  spaceId: null,
  pinnedConnectionId: null,
  root:
    children.length === 1
      ? (children[0] as LayoutNode)
      : {
          type: 'split',
          id: 's',
          direction: 'row',
          sizes: children.map(() => 100 / children.length),
          children,
        },
});

test('shells are numbered when a session has several, and show their directory', () => {
  const t = tab([ssh('a'), ssh('b'), term('c')]);
  const [a, b, c] = [0, 1, 2].map((i) => (t.root.type === 'split' ? t.root.children[i] : t.root));
  expect(paneLabel(t, a as never, names)).toMatchObject({ title: 'Shell 1', detail: '/var/www' });
  expect(paneLabel(t, b as never, names).title).toBe('Shell 2');
  expect(paneLabel(t, c as never, names)).toMatchObject({ title: 'Shell 3', detail: 'PowerShell' });
});

test('files and the monitor name the connection they belong to', () => {
  const files: LayoutNode = {
    type: 'leaf',
    id: 'f',
    panel: { kind: 'sftp', linkedLeafId: 'a', path: '/etc', follow: true, cwd: null, title: null },
  };
  const monitor: LayoutNode = {
    type: 'leaf',
    id: 'm',
    panel: {
      kind: 'monitor',
      source: { kind: 'remote', linkedLeafId: 'a' },
      cwd: null,
      title: null,
    },
  };
  const t = tab([ssh('a'), files, monitor]);
  expect(paneLabel(t, files as never, names)).toMatchObject({
    title: 'Fichiers',
    owner: 'demo-server',
    detail: '/etc',
  });
  expect(paneLabel(t, monitor as never, names)).toMatchObject({
    title: 'Moniteur',
    owner: 'demo-server',
  });
});

test('a session is named after what it was given, its connection, or its shell', () => {
  expect(sessionTitle(tab([ssh('a')]), names)).toBe('demo-server');
  expect(sessionTitle(tab([ssh('a', null)]), names)).toBe('osc title');
  expect(sessionTitle(tab([term('a')]), names)).toBe('PowerShell');
  expect(sessionTitle(tab([term('a')], 'build'), names)).toBe('build');
});
