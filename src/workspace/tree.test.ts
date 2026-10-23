import {
  layoutRects,
  leaves,
  neighbor,
  removeLeaf,
  resizeAt,
  splitHandles,
  splitLeaf,
} from './tree';
import type { LayoutNode, LeafNode } from './types';

const leaf = (id: string): LeafNode => ({
  type: 'leaf',
  id,
  panel: { kind: 'terminal', profileId: 'cmd', cwd: null, title: null },
});

const split = (
  id: string,
  direction: 'row' | 'column',
  children: LayoutNode[],
  sizes?: number[],
): LayoutNode => ({
  type: 'split',
  id,
  direction,
  children,
  sizes: sizes ?? children.map(() => 100 / children.length),
});

const ids = (n: LayoutNode | null) => (n ? leaves(n).map((l) => l.id) : []);

function sizesOf(n: LayoutNode | null): number[] {
  if (n?.type !== 'split') throw new Error('expected a split');
  return n.sizes;
}

test('split same direction inserts sibling with equal sizes', () => {
  const root = split('s', 'row', [leaf('a'), leaf('b')]);
  const out = splitLeaf(root, 'a', 'row', leaf('c'));
  expect(ids(out)).toEqual(['a', 'c', 'b']);
  const sizes = sizesOf(out);
  sizes.forEach((s) => {
    expect(s).toBeCloseTo(100 / 3);
  });
  expect(sizes.reduce((x, y) => x + y)).toBeCloseTo(100);
});

test('split other direction nests', () => {
  const out = splitLeaf(leaf('a'), 'a', 'column', leaf('b'));
  expect(out).toMatchObject({ type: 'split', direction: 'column', sizes: [50, 50] });
  expect(ids(out)).toEqual(['a', 'b']);
});

test('split inside a perpendicular split nests only that leaf', () => {
  const root = split('s', 'row', [leaf('a'), leaf('b')]);
  const out = splitLeaf(root, 'b', 'column', leaf('c'));
  expect(out).toMatchObject({ type: 'split', direction: 'row', sizes: [50, 50] });
  if (out.type !== 'split') throw new Error();
  expect(out.children[1]).toMatchObject({ type: 'split', direction: 'column' });
  expect(ids(out)).toEqual(['a', 'b', 'c']);
});

test('remove collapses single-child splits', () => {
  let root: LayoutNode | null = split('s', 'row', [
    leaf('a'),
    split('t', 'column', [leaf('b'), leaf('c')]),
  ]);
  root = removeLeaf(root, 'b');
  expect(root).toMatchObject({ type: 'split', direction: 'row' });
  expect(ids(root)).toEqual(['a', 'c']);
  if (!root) throw new Error();
  root = removeLeaf(root, 'c');
  expect(root).toMatchObject({ type: 'leaf', id: 'a' });
  if (!root) throw new Error();
  expect(removeLeaf(root, 'a')).toBeNull();
});

test('remove renormalizes sizes', () => {
  const root = split('s', 'row', [leaf('a'), leaf('b'), leaf('c')], [20, 30, 50]);
  const [x = 0, y = 0] = sizesOf(removeLeaf(root, 'b'));
  expect(x).toBeCloseTo(28.5714, 3);
  expect(y).toBeCloseTo(71.4285, 3);
});

test('remove of an unknown leaf returns the tree unchanged', () => {
  const root = split('s', 'row', [leaf('a'), leaf('b')]);
  expect(removeLeaf(root, 'zzz')).toEqual(root);
});

test('neighbor finds panes geometrically', () => {
  // a | (b over c)
  const root = split('s', 'row', [leaf('a'), split('t', 'column', [leaf('b'), leaf('c')])]);
  expect(neighbor(root, 'a', 'right')).toBe('b');
  expect(neighbor(root, 'c', 'left')).toBe('a');
  expect(neighbor(root, 'b', 'down')).toBe('c');
  expect(neighbor(root, 'c', 'up')).toBe('b');
  expect(neighbor(root, 'a', 'left')).toBeNull();
  expect(neighbor(root, 'b', 'right')).toBeNull();
});

test('neighbor respects sizes', () => {
  // (a over b) | c, where a is short: from c going left, the overlap-wise closest by
  // center is b (it covers most of c's height).
  const root = split('s', 'row', [
    split('t', 'column', [leaf('a'), leaf('b')], [20, 80]),
    leaf('c'),
  ]);
  expect(neighbor(root, 'c', 'left')).toBe('b');
});

test('leaves are in visual order', () => {
  const root = split('s', 'column', [split('t', 'row', [leaf('a'), leaf('b')]), leaf('c')]);
  expect(ids(root)).toEqual(['a', 'b', 'c']);
});

test('layoutRects gives each leaf its normalized rectangle', () => {
  const root = split(
    's',
    'row',
    [leaf('a'), split('t', 'column', [leaf('b'), leaf('c')], [25, 75])],
    [40, 60],
  );
  const r = layoutRects(root);
  expect(r.get('a')).toEqual({ x: 0, y: 0, w: 0.4, h: 1 });
  const b = r.get('b');
  const c = r.get('c');
  expect(b?.x).toBeCloseTo(0.4);
  expect(b?.h).toBeCloseTo(0.25);
  expect(c?.y).toBeCloseTo(0.25);
  expect(c?.h).toBeCloseTo(0.75);
});

test('splitHandles sit on child boundaries', () => {
  const root = split(
    's',
    'row',
    [leaf('a'), split('t', 'column', [leaf('b'), leaf('c')], [25, 75])],
    [40, 60],
  );
  const handles = splitHandles(root);
  expect(handles).toHaveLength(2);
  const [outer, inner] = handles;
  expect(outer).toMatchObject({ splitId: 's', index: 0, direction: 'row' });
  expect(outer?.position).toBeCloseTo(0.4);
  expect(outer?.span).toEqual({ start: 0, length: 1 });
  expect(inner).toMatchObject({ splitId: 't', index: 0, direction: 'column' });
  expect(inner?.position).toBeCloseTo(0.25);
  expect(inner?.span.start).toBeCloseTo(0.4);
  expect(inner?.span.length).toBeCloseTo(0.6);
});

test('resizeAt moves one boundary and clamps to a minimum size', () => {
  expect(resizeAt([50, 50], 0, 0.3)).toEqual([30, 70]);
  const [x = 0, y = 0, z = 0] = resizeAt([20, 30, 50], 1, 0.95);
  expect(x).toBeCloseTo(20);
  expect(y + z).toBeCloseTo(80);
  expect(z).toBeCloseTo(5);
});
