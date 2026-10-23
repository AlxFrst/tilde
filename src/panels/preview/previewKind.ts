export type PreviewKind = 'markdown' | 'image' | 'json';

const IMAGE = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'svg', 'avif'];

/** Which viewer a file opens in, or `null` if it has none. */
export function previewKind(fileName: string): PreviewKind | null {
  const ext = fileName.toLowerCase().split('.').pop() ?? '';
  if (ext === 'md' || ext === 'markdown') return 'markdown';
  if (ext === 'json') return 'json';
  return IMAGE.includes(ext) ? 'image' : null;
}

/** The MIME type a blob of this image needs to display. */
export function imageMime(fileName: string): string {
  const ext = fileName.toLowerCase().split('.').pop() ?? '';
  if (ext === 'svg') return 'image/svg+xml';
  if (ext === 'jpg') return 'image/jpeg';
  if (ext === 'ico') return 'image/x-icon';
  return `image/${ext}`;
}
