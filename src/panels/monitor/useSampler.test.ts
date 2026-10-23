import { act, renderHook } from '@testing-library/react';
import type { Snapshot } from '@/ipc/monitor';
import { useSampler } from './useSampler';

const snap = (n: number): Snapshot => ({
  cpuPercent: n,
  cores: 4,
  memTotal: 100,
  memUsed: 50,
  swapTotal: 0,
  swapUsed: 0,
  load: null,
  uptimeSecs: 1,
  netRxPerSec: 0,
  netTxPerSec: 0,
  disks: [],
  host: 'h',
});

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

const flush = () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });

test('polls every 2 s only while active', async () => {
  let n = 0;
  const fetch = vi.fn(() => Promise.resolve(snap(n++)));
  const { result, rerender } = renderHook(({ active }) => useSampler(fetch, active), {
    initialProps: { active: true },
  });
  await flush();
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(result.current.latest?.cpuPercent).toBe(0);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2000);
  });
  expect(fetch).toHaveBeenCalledTimes(2);
  rerender({ active: false });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10_000);
  });
  expect(fetch).toHaveBeenCalledTimes(2);
  rerender({ active: true });
  await flush();
  expect(fetch).toHaveBeenCalledTimes(3);
});

test('a failing remote monitor backs off and shows one message', async () => {
  const error = { kind: 'disconnected', message: 'cette session SSH n’est plus ouverte' };
  // Tauri rejects with the error DTO, not an Error.
  const fetch = vi.fn<() => Promise<Snapshot>>().mockRejectedValue(error);
  const { result } = renderHook(() => useSampler(fetch, true));
  await flush();
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(result.current.error).toEqual(error);
  const first = result.current.error;
  // Next tries after 4, 8 and 16 s instead of every 2 s.
  for (const [wait, calls] of [
    [3999, 1],
    [1, 2],
    [7999, 2],
    [1, 3],
    [16_000, 4],
  ] as const) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(wait);
    });
    expect(fetch).toHaveBeenCalledTimes(calls);
  }
  // The same message is not re-raised (no re-render storm, no toast).
  expect(result.current.error).toBe(first);
});

test('keeps 60 samples', async () => {
  let n = 0;
  const fetch = vi.fn(() => Promise.resolve(snap(n++)));
  const { result } = renderHook(() => useSampler(fetch, true, 100));
  for (let i = 0; i < 70; i++) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
  }
  expect(result.current.history).toHaveLength(60);
  expect(result.current.history.at(-1)).toBe(result.current.latest);
});
