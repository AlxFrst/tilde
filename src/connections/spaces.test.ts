import type { Connection, ConnectionsFile } from '@/ipc/connections';
import { connectionSpace, listSpaces, MAIN_SPACE, spaceIdOf } from './spaces';

const file = (extra: Partial<ConnectionsFile> = {}): ConnectionsFile => ({
  version: 1,
  spaces: [],
  folders: [],
  connections: [],
  recents: [],
  ...extra,
});

const pro = { id: 'pro', name: 'Pro', color: '#7AA2F7', icon: 'briefcase' };

test('listSpaces returns Principal when the file has none', () => {
  expect(listSpaces(file())).toEqual([MAIN_SPACE]);
  expect(MAIN_SPACE).toEqual({ id: 'main', name: 'Principal', color: null, icon: null });
  const spaces = [MAIN_SPACE, pro];
  expect(listSpaces(file({ spaces }))).toEqual(spaces);
});

test('spaceIdOf falls back to the first space for null or unknown ids', () => {
  const spaces = [MAIN_SPACE, pro];
  expect(spaceIdOf({ spaceId: 'pro' }, spaces)).toBe('pro');
  expect(spaceIdOf({ spaceId: null }, spaces)).toBe('main');
  expect(spaceIdOf({ spaceId: 'gone' }, spaces)).toBe('main');
  expect(spaceIdOf({ spaceId: null }, [pro])).toBe('pro');
});

test('connectionSpace follows the folder', () => {
  const c = { id: 'c', folderId: 'f', spaceId: null } as Connection;
  const f = file({
    spaces: [MAIN_SPACE, pro],
    folders: [{ id: 'f', name: 'Prod', color: null, spaceId: 'pro' }],
    connections: [c],
  });
  expect(connectionSpace(c, f)).toBe('pro');
  expect(connectionSpace({ ...c, folderId: null }, f)).toBe('main');
  expect(connectionSpace({ ...c, folderId: null, spaceId: 'pro' }, f)).toBe('pro');
});
