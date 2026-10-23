import { act, renderHook, waitFor } from '@testing-library/react';
import { editorOpenRemote, editorSaveRemote, editorReadLocal } from '@/ipc/editor';
import { primeLocal, useDocument } from './useDocument';

vi.mock('@/ipc/editor', async (orig) => ({
  ...(await orig<typeof import('@/ipc/editor')>()),
  editorOpenRemote: vi.fn(),
  editorSaveRemote: vi.fn(),
  editorSaveLocal: vi.fn(),
  editorReadLocal: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const remote = { kind: 'remote', linkedLeafId: 'ssh', path: '/etc/app.conf' } as const;
const v1 = { size: 4, mtime: 100 };
const v2 = { size: 9, mtime: 160 };

beforeEach(() => {
  vi.clearAllMocks();
});

test('loads then saves with the stamp it read', async () => {
  vi.mocked(editorOpenRemote).mockResolvedValue({ text: 'a=1\n', stamp: v1 });
  vi.mocked(editorSaveRemote).mockResolvedValue(v2);
  const { result } = renderHook(() => useDocument(remote, 4));
  await waitFor(() => {
    expect(result.current.status).toBe('ready');
  });
  expect(result.current.text).toBe('a=1\n');
  expect(editorOpenRemote).toHaveBeenCalledWith(4, '/etc/app.conf');

  let outcome = '';
  await act(async () => {
    outcome = await result.current.save('a=2\nb=3\n');
  });
  expect(outcome).toBe('saved');
  expect(editorSaveRemote).toHaveBeenCalledWith(4, '/etc/app.conf', 'a=2\nb=3\n', v1, false);
  // The next save expects the version just written.
  await act(async () => {
    await result.current.save('a=3\n');
  });
  expect(editorSaveRemote).toHaveBeenLastCalledWith(4, '/etc/app.conf', 'a=3\n', v2, false);
});

test('a conflict on save asks before overwriting', async () => {
  vi.mocked(editorOpenRemote).mockResolvedValue({ text: 'a=1\n', stamp: v1 });
  vi.mocked(editorSaveRemote).mockRejectedValueOnce({
    kind: 'conflict',
    message: 'le fichier a changé depuis son ouverture',
    current: v2,
  });
  const { result } = renderHook(() => useDocument(remote, 4));
  await waitFor(() => {
    expect(result.current.status).toBe('ready');
  });
  let outcome = '';
  await act(async () => {
    outcome = await result.current.save('mine\n');
  });
  expect(outcome).toBe('conflict');
  expect(result.current.conflict).toBe(true);

  vi.mocked(editorSaveRemote).mockResolvedValueOnce({ size: 5, mtime: 200 });
  await act(async () => {
    outcome = await result.current.save('mine\n', true);
  });
  expect(outcome).toBe('saved');
  expect(editorSaveRemote).toHaveBeenLastCalledWith(4, '/etc/app.conf', 'mine\n', v1, true);
  expect(result.current.conflict).toBe(false);
});

test('reload replaces the text and the stamp', async () => {
  vi.mocked(editorOpenRemote)
    .mockResolvedValueOnce({ text: 'old\n', stamp: v1 })
    .mockResolvedValueOnce({ text: 'new from server\n', stamp: v2 });
  vi.mocked(editorSaveRemote).mockResolvedValue({ size: 1, mtime: 1 });
  const { result } = renderHook(() => useDocument(remote, 4));
  await waitFor(() => {
    expect(result.current.status).toBe('ready');
  });
  await act(async () => {
    await result.current.reload();
  });
  expect(result.current.text).toBe('new from server\n');
  await act(async () => {
    await result.current.save('x');
  });
  expect(editorSaveRemote).toHaveBeenLastCalledWith(4, '/etc/app.conf', 'x', v2, false);
});

test('a local document opened through the dialog is not read twice', async () => {
  primeLocal({ docId: 7, name: 'notes.txt', text: 'hello', stamp: v1 });
  const { result } = renderHook(() =>
    useDocument({ kind: 'local', docId: 7, name: 'notes.txt' }, null),
  );
  await waitFor(() => {
    expect(result.current.status).toBe('ready');
  });
  expect(result.current.text).toBe('hello');
  expect(editorReadLocal).not.toHaveBeenCalled();
});

test('a remote document waits for its SSH session', () => {
  const { result } = renderHook(() => useDocument(remote, null));
  expect(result.current.status).toBe('loading');
  expect(editorOpenRemote).not.toHaveBeenCalled();
});
