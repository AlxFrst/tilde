import { search, type SearchItem } from './search';

const item = (label: string, host: string, extra: Partial<SearchItem> = {}): SearchItem => ({
  key: `conn:${label}`,
  label,
  host,
  user: null,
  tags: [],
  kind: 'connection',
  ...extra,
});

const items = [
  item('Préprod web', 'pp.example', { tags: ['web'] }),
  item('Prod db', 'db.internal', { user: 'postgres' }),
  item('Staging', 'stg.example', { tags: ['qa'] }),
];

const labels = (q: string) => search(q, items).map((i) => i.label);

test('fuzzy search ignores case and accents and matches host user and tags', () => {
  expect(labels('prepro')[0]).toBe('Préprod web');
  expect(labels('PRÉPROD')[0]).toBe('Préprod web');
  expect(labels('postgres')).toEqual(['Prod db']);
  expect(labels('QA')).toEqual(['Staging']);
  expect(labels('stg.ex')).toEqual(['Staging']);
  expect(labels('zzzz')).toEqual([]);
});

test('empty query keeps the original order', () => {
  expect(labels('')).toEqual(['Préprod web', 'Prod db', 'Staging']);
  expect(labels('   ')).toEqual(['Préprod web', 'Prod db', 'Staging']);
});
