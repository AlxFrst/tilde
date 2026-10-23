/**
 * Coalesces terminal resizes: one call per settled size, at most every `delayMs`,
 * never for an unchanged or empty size (hidden/collapsed panes report 0).
 */
export function createResizeScheduler(
  send: (cols: number, rows: number) => void,
  delayMs = 50,
): { schedule(cols: number, rows: number): void; dispose(): void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let last = '';
  return {
    schedule(cols, rows) {
      if (cols <= 0 || rows <= 0) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        const key = `${cols}x${rows}`;
        if (key === last) return;
        last = key;
        send(cols, rows);
      }, delayMs);
    },
    dispose() {
      clearTimeout(timer);
    },
  };
}
