import { enableLigatures, ligatureRanges } from './ligatures';

test('finds ligature sequences', () => {
  expect(ligatureRanges('a => b !== c')).toEqual([
    [2, 4],
    [7, 10],
  ]);
});

test('the longest sequence wins', () => {
  // `->>` is not a ligature, `->` is; `<!--` beats `<!` and `--`.
  expect(ligatureRanges('a ->> b')).toEqual([[2, 4]]);
  expect(ligatureRanges('<!-- x')).toEqual([[0, 4]]);
  expect(ligatureRanges('x === y')).toEqual([[2, 5]]);
});

test('repeated sequences give contiguous ranges', () => {
  expect(ligatureRanges('->'.repeat(3))).toEqual([
    [0, 2],
    [2, 4],
    [4, 6],
  ]);
  expect(ligatureRanges('')).toEqual([]);
  expect(ligatureRanges('plain text')).toEqual([]);
});

test('enableLigatures registers and removes a joiner', () => {
  const term = {
    registerCharacterJoiner: vi.fn(() => 7),
    deregisterCharacterJoiner: vi.fn(),
  };
  const off = enableLigatures(term);
  expect(term.registerCharacterJoiner).toHaveBeenCalledWith(ligatureRanges);
  off();
  expect(term.deregisterCharacterJoiner).toHaveBeenCalledWith(7);
});
