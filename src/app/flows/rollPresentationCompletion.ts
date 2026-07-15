import { REMOTE_ROLL_RESULT_HOLD_MS, waitForGameAnimation } from './gameAnimationQueue';

export const REMOTE_ROLL_SETTLE_WATCHDOG_MS = 12000;

export type RollPresentationCompletionResult = 'settled' | 'watchdog' | 'cancelled';

type RollPresentationCompletionOptions = {
  resultHoldMs?: number;
  watchdogMs?: number;
  waitForHold?: (durationMs: number) => Promise<void>;
};

export type RollPresentationCompletion = {
  markSettled: () => void;
  cancel: () => void;
  waitForCompletion: () => Promise<RollPresentationCompletionResult>;
};

export function createRollPresentationCompletion({
  resultHoldMs = REMOTE_ROLL_RESULT_HOLD_MS,
  watchdogMs = REMOTE_ROLL_SETTLE_WATCHDOG_MS,
  waitForHold = waitForGameAnimation,
}: RollPresentationCompletionOptions = {}): RollPresentationCompletion {
  let settled = false;
  let cancelled = false;
  let resolveSettled!: () => void;
  let resolveCancelled!: () => void;

  const settledPromise = new Promise<void>((resolve) => {
    resolveSettled = resolve;
  });
  const cancelledPromise = new Promise<void>((resolve) => {
    resolveCancelled = resolve;
  });

  const markSettled = () => {
    if (settled || cancelled) return;
    settled = true;
    resolveSettled();
  };

  const cancel = () => {
    if (cancelled) return;
    cancelled = true;
    resolveCancelled();
  };

  const waitForCompletion = async (): Promise<RollPresentationCompletionResult> => {
    let watchdogTimer: ReturnType<typeof setTimeout> | null = null;
    const watchdogPromise = new Promise<'watchdog'>((resolve) => {
      watchdogTimer = setTimeout(() => resolve('watchdog'), Math.max(0, watchdogMs));
    });

    const completion = await Promise.race([
      settledPromise.then(() => 'settled' as const),
      cancelledPromise.then(() => 'cancelled' as const),
      watchdogPromise,
    ]);

    if (watchdogTimer !== null) clearTimeout(watchdogTimer);
    if (completion === 'cancelled') return completion;

    const heldCompletion = await Promise.race([
      waitForHold(Math.max(0, resultHoldMs)).then(() => completion),
      cancelledPromise.then(() => 'cancelled' as const),
    ]);
    return heldCompletion;
  };

  return { markSettled, cancel, waitForCompletion };
}
