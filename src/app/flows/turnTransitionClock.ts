export type TurnTransitionClockScheduler<TTimer = ReturnType<typeof setTimeout>> = {
  now?: () => number;
  setTimeout?: (callback: () => void, delayMs: number) => TTimer;
  clearTimeout?: (timeoutId: TTimer) => void;
};

export function scheduleTurnTransitionBoundary<TTimer = ReturnType<typeof setTimeout>>(
  targetAt: number,
  onReached: () => void,
  scheduler: TurnTransitionClockScheduler<TTimer> = {},
) {
  if (!Number.isFinite(targetAt) || targetAt <= 0) return () => {};

  const now = scheduler.now ?? Date.now;
  const scheduleTimeout = scheduler.setTimeout
    ?? ((callback, delayMs) => globalThis.setTimeout(callback, delayMs) as unknown as TTimer);
  const cancelTimeout = scheduler.clearTimeout
    ?? ((timeoutId) => globalThis.clearTimeout(timeoutId as unknown as ReturnType<typeof setTimeout>));
  let timeoutId: TTimer | undefined;
  let settled = false;

  const checkBoundary = () => {
    timeoutId = undefined;
    if (settled) return;

    const remainingMs = targetAt - now();
    if (remainingMs > 0) {
      timeoutId = scheduleTimeout(checkBoundary, Math.max(1, Math.ceil(remainingMs)));
      return;
    }

    settled = true;
    onReached();
  };

  checkBoundary();

  return () => {
    settled = true;
    if (timeoutId !== undefined) {
      cancelTimeout(timeoutId);
      timeoutId = undefined;
    }
  };
}
