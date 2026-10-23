import { go } from 'fuzzysort';

/** Anything the sidebar or the palette can search: saved connections, ssh_config hosts, recents. */
export interface SearchItem {
  key: string;
  label: string;
  host: string;
  user: string | null;
  tags: string[];
  kind: 'connection' | 'sshConfig' | 'recent';
}

/** Lower case, accents removed: « Préprod » is found by « prepro ». */
export const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

const KEYS = [
  (i: SearchItem) => fold(i.label),
  (i: SearchItem) => fold(i.host),
  (i: SearchItem) => fold(i.user ?? ''),
  (i: SearchItem) => fold(i.tags.join(' ')),
];

/** Best matches first; the items unchanged when the query is blank. */
export function search<T extends SearchItem>(query: string, items: readonly T[]): T[] {
  const q = fold(query.trim());
  if (!q) return [...items];
  return go(q, items, { keys: KEYS, limit: 0 }).map((r) => r.obj);
}
