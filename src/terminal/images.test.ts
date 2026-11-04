import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ImageAddon } from '@xterm/addon-image';
import { Terminal } from '@xterm/xterm';
import { IMAGE_ADDON_OPTIONS } from './createTerminal';

// A real xterm with the real image addon, not opened: jsdom has no layout and no 2D canvas,
// so a picture's pixels can't be drawn or read back here; where it lands and its size can.
// Without a context, jsdom logs "not implemented" for every canvas; the addon copes.
vi.hoisted(() => {
  HTMLCanvasElement.prototype.getContext = () => null;
});

const ESC = '\u001b';
/** A 2 × 6 red Sixel: raster attributes, one colour register, two full columns. */
const SIXEL = `${ESC}P0;1q"1;1;2;6#1;2;100;0;0#1~~${ESC}\\`;
/** A 1 × 1 PNG, as imgcat sends it. */
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function inlineImage(base64: string) {
  return `${ESC}]1337;File=inline=1;size=${String(atob(base64).length)}:${base64}\u0007`;
}

function write(term: Terminal, data: string) {
  return new Promise<void>((resolve) => {
    term.write(data, resolve);
  });
}

function terminalWithImages() {
  const term = new Terminal({ allowProposedApi: true, cols: 80, rows: 24 });
  const images = new ImageAddon(IMAGE_ADDON_OPTIONS);
  term.loadAddon(images);
  return { term, images };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

test('the image addon starts with Tilde’s storage limit and answers size queries', () => {
  const { term, images } = terminalWithImages();
  expect(images.storageLimit).toBe(32);
  expect(term.options.windowOptions).toMatchObject({
    getWinSizePixels: true,
    getCellSizePixels: true,
    getWinSizeChars: true,
  });
  term.dispose();
});

test('a Sixel picture is decoded and placed at the cursor', async () => {
  const { term, images } = terminalWithImages();
  // The Sixel decoder is WebAssembly, compiled while the addon loads; a picture that
  // arrives before it is ready is dropped, so send until one lands, then start clean
  // with a full reset (RIS, what `reset` sends), which clears the pictures too.
  await vi.waitFor(async () => {
    await write(term, SIXEL);
    expect(images.storageUsage).toBeGreaterThan(0);
  });
  await write(term, `${ESC}c`);
  expect(images.storageUsage).toBe(0);

  await write(term, SIXEL);
  const picture = images.getImageAtBufferCell(0, 0);
  expect(picture).toBeInstanceOf(HTMLCanvasElement);
  expect([picture?.width, picture?.height]).toEqual([2, 6]);
  expect(images.getImageAtBufferCell(1, 0)).toBeUndefined();
  term.dispose();
});

test('an inline image (iTerm2 protocol) is decoded and placed at the cursor', async () => {
  const bitmap = { width: 1, height: 1, close: vi.fn() };
  // jsdom lacks createImageBitmap, which a browser uses to decode the PNG.
  const createImageBitmap = vi.fn(() => Promise.resolve(bitmap));
  vi.stubGlobal('createImageBitmap', createImageBitmap);
  const { term, images } = terminalWithImages();

  await write(term, inlineImage(PNG_BASE64));
  expect(createImageBitmap).toHaveBeenCalledTimes(1);
  const [blob] = createImageBitmap.mock.calls[0] as unknown as [Blob];
  expect(blob.type).toBe('image/png');
  expect(blob.size).toBe(atob(PNG_BASE64).length);
  expect(images.getImageAtBufferCell(0, 0)).toBe(bitmap);
  term.dispose();
});

test('an inline image above 4096 × 4096 pixels is refused before it is decoded', async () => {
  const createImageBitmap = vi.fn(() => Promise.resolve({ width: 1, height: 1, close() {} }));
  vi.stubGlobal('createImageBitmap', createImageBitmap);
  const { term } = terminalWithImages();
  // The same PNG, its header announcing another size: the addon checks it first.
  const announcing = (width: number, height: number) => {
    const bytes = Uint8Array.from(atob(PNG_BASE64), (c) => c.charCodeAt(0));
    const header = new DataView(bytes.buffer);
    header.setUint32(16, width);
    header.setUint32(20, height);
    return inlineImage(btoa(String.fromCharCode(...bytes)));
  };

  await write(term, announcing(4000, 4000));
  expect(createImageBitmap).toHaveBeenCalledTimes(1);
  await write(term, announcing(5000, 5000));
  expect(createImageBitmap).toHaveBeenCalledTimes(1);
  term.dispose();
});

describe('the app’s content security policy', () => {
  const { security } = (
    JSON.parse(readFileSync(join(__dirname, '../../src-tauri/tauri.conf.json'), 'utf8')) as {
      app: { security: { csp: string; devCsp?: string } };
    }
  ).app;

  function scriptSources(csp: string) {
    const directive = csp
      .split(';')
      .map((d) => d.trim().split(/\s+/))
      .find(([name]) => name === 'script-src');
    return directive?.slice(1) ?? [];
  }

  // Both image decoders are WebAssembly compiled from bytes in the bundle: without
  // 'wasm-unsafe-eval' the webview refuses them, and no picture ever shows.
  test('lets the image decoders compile WebAssembly, and allows no eval', () => {
    for (const csp of [security.csp, security.devCsp ?? security.csp]) {
      const scripts = scriptSources(csp);
      expect(scripts).toContain("'wasm-unsafe-eval'");
      expect(scripts).toContain("'self'");
      expect(scripts).not.toContain("'unsafe-eval'");
      expect(scripts).not.toContain("'unsafe-inline'");
    }
  });
});
