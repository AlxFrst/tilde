import { act, render, screen, waitFor } from '@testing-library/react';
import { editorOpenRemote, previewReadRemote } from '@/ipc/editor';
import { useEditors } from '@/stores/editors';
import { registerSession } from '@/terminal/sessionRegistry';
import type { PreviewPanel } from '@/workspace/types';
import PreviewPane from './PreviewPane';
import { previewKind } from './previewKind';

vi.mock('@/ipc/editor', async (orig) => ({
  ...(await orig<typeof import('@/ipc/editor')>()),
  editorOpenRemote: vi.fn(),
  previewReadRemote: vi.fn(),
}));

function pane(state: PreviewPanel) {
  return (
    <PreviewPane tabId="t" leafId="pv" state={state} active update={vi.fn()} close={vi.fn()} />
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  useEditors.setState({ docs: {} });
  registerSession('ssh-1', 4);
});

test('previewKind picks the viewer from the file name', () => {
  expect(previewKind('README.md')).toBe('markdown');
  expect(previewKind('photo.JPG')).toBe('image');
  expect(previewKind('logo.svg')).toBe('image');
  expect(previewKind('package.json')).toBe('json');
  expect(previewKind('main.rs')).toBeNull();
});

test('follows the editor text live', async () => {
  useEditors.setState({ docs: { ed: { name: 'NOTES.md', dirty: true, text: '# Un' } } });
  render(
    pane({
      kind: 'preview',
      source: { kind: 'editor', editorLeafId: 'ed', name: 'NOTES.md' },
      cwd: null,
      title: null,
    }),
  );
  expect(await screen.findByRole('heading', { name: 'Un' })).toBeInTheDocument();
  act(() => {
    useEditors.getState().set('ed', { text: '# Deux' });
  });
  expect(await screen.findByRole('heading', { name: 'Deux' })).toBeInTheDocument();
});

test('invalid JSON shows the error position', async () => {
  vi.mocked(editorOpenRemote).mockResolvedValue({
    text: '{\n  "a": 1,\n}',
    stamp: { size: 1, mtime: 1 },
  });
  render(
    pane({
      kind: 'preview',
      source: { kind: 'remote', linkedLeafId: 'ssh-1', path: '/srv/app.json' },
      cwd: null,
      title: null,
    }),
  );
  expect(await screen.findByRole('alert')).toHaveTextContent(/JSON invalide/);
});

test('an image is shown from a blob URL and revoked on unmount', async () => {
  const create = vi.fn(() => 'blob:tilde/1');
  const revoke = vi.fn();
  Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke });
  vi.mocked(previewReadRemote).mockResolvedValue(new Uint8Array([137, 80, 78, 71]).buffer);
  const { unmount } = render(
    pane({
      kind: 'preview',
      source: { kind: 'remote', linkedLeafId: 'ssh-1', path: '/srv/logo.png' },
      cwd: null,
      title: null,
    }),
  );
  const img = await screen.findByRole('img', { name: 'logo.png' });
  expect(img).toHaveAttribute('src', 'blob:tilde/1');
  expect(previewReadRemote).toHaveBeenCalledWith(4, '/srv/logo.png');
  unmount();
  await waitFor(() => {
    expect(revoke).toHaveBeenCalledWith('blob:tilde/1');
  });
});
