import { createResizeScheduler } from './resize';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

test('resize scheduler debounces, dedups and ignores zero sizes', () => {
  const send = vi.fn();
  const s = createResizeScheduler(send, 50);
  s.schedule(80, 24);
  vi.advanceTimersByTime(5);
  s.schedule(80, 24);
  vi.advanceTimersByTime(5);
  s.schedule(80, 24);
  expect(send).not.toHaveBeenCalled();
  vi.advanceTimersByTime(50);
  expect(send).toHaveBeenCalledTimes(1);
  expect(send).toHaveBeenCalledWith(80, 24);

  s.schedule(80, 24);
  vi.advanceTimersByTime(100);
  expect(send).toHaveBeenCalledTimes(1);

  s.schedule(0, 24);
  vi.advanceTimersByTime(100);
  expect(send).toHaveBeenCalledTimes(1);

  s.schedule(100, 30);
  vi.advanceTimersByTime(50);
  expect(send).toHaveBeenLastCalledWith(100, 30);
  expect(send).toHaveBeenCalledTimes(2);
});

test('dispose cancels a pending resize', () => {
  const send = vi.fn();
  const s = createResizeScheduler(send, 50);
  s.schedule(90, 20);
  s.dispose();
  vi.advanceTimersByTime(100);
  expect(send).not.toHaveBeenCalled();
});
