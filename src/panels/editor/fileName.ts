import type { FileSource } from '@/workspace/types';

/** The file name shown for a source (tab, toolbar, close confirmation). */
export function fileName(source: FileSource): string {
  return source.kind === 'local' ? source.name : (source.path.split('/').pop() ?? source.path);
}

/** Two sources designate the same file (an already open editor is focused instead). */
export function sameSource(a: FileSource, b: FileSource): boolean {
  if (a.kind === 'local' || b.kind === 'local') {
    return a.kind === 'local' && b.kind === 'local' && a.docId === b.docId;
  }
  return a.linkedLeafId === b.linkedLeafId && a.path === b.path;
}
