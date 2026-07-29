export type TurnTransitionClockScheduler = {
  now?: () => number;
  setTimeout?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  clearTimeout?: (timeoutId: ReturnType<typeof setTimeout>) => void;
};

export function scheduleTurnTransitionBoundary(
  targetAt: number,
  onReached: () => void,
  scheduler: TurnTransitionClockScheduler = {},
) {
  if (!Number.isFinite(targetAt) || targetAt <= 0) return () => {};

  const now = scheduler.now ?? Date.now;
  const scheduleTimeout = scheduler.setTimeout ?? ((callback, delayMs) => globalThis.setTimeout(callback, delayMs));
  const cancelTimeout = scheduler.clearTimeout ?? ((timeoutId) => globalThis.clearTimeout(timeoutId));
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
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
