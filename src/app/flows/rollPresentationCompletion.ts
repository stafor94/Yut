import { REMOTE_ROLL_RESULT_HOLD_MS, waitForGameAnimation } from './gameAnimationQueue';

export const REMOTE_ROLL_SETTLE_WATCHDOG_MS = 12000;

export type RollPresentationSettleSource = 'renderer-settled';
export type RollPresentationVisualResult = RollPresentationSettleSource | 'watchdog' | 'cancelled';
export type RollPresentationResultHoldResult = 'held' | 'cancelled';
export type RollPresentationCompletionResult = Exclude<RollPresentationVisualResult, 'cancelled'> | 'cancelled';

export type RollPresentationCompletion = {
  markSettled: (source: RollPresentationSettleSource) => void;
  cancel: () => void;
  waitForVisualSettle: () => Promise<RollPresentationVisualResult>;
  waitForResultHold: () => Promise<RollPresentationResultHoldResult>;
  waitForCompletion: () => Promise<RollPresentationCompletionResult>;
};

type RollPresentationCompletionOptions = {
  resultHoldMs?: number;
  watchdogMs?: number;
  waitForHold?: (durationMs: number) => Promise<void>;
};

export function createRollPresentationCompletion({
  resultHoldMs = REMOTE_ROLL_RESULT_HOLD_MS,
  watchdogMs = REMOTE_ROLL_SETTLE_WATCHDOG_MS,
  waitForHold = waitForGameAnimation,
}: RollPresentationCompletionOptions = {}): RollPresentationCompletion {
  let settled = false;
  let cancelled = false;
  let resolveSettled!: (source: RollPresentationSettleSource) => void;
  let resolveCancelled!: () => void;
  const settledPromise = new Promise<RollPresentationSettleSource>((resolve) => {
    resolveSettled = resolve;
  });
  const cancelledPromise = new Promise<void>((resolve) => {
    resolveCancelled = resolve;
  });

  const markSettled = (source: RollPresentationSettleSource) => {
    if (settled || cancelled) return;
    settled = true;
    resolveSettled(source);
  };

  const cancel = () => {
    if (cancelled) return;
    cancelled = true;
    resolveCancelled();
  };

  const waitForVisualSettle = async (): Promise<RollPresentationVisualResult> => {
    if (cancelled) return 'cancelled';
    let watchdogTimer: ReturnType<typeof setTimeout> | null = null;
    const watchdogPromise = new Promise<'watchdog'>((resolve) => {
      watchdogTimer = setTimeout(() => resolve('watchdog'), Math.max(0, watchdogMs));
    });
    const result = await Promise.race<RollPresentationVisualResult>([
      settledPromise,
      watchdogPromise,
      cancelledPromise.then(() => 'cancelled' as const),
    ]);
    if (watchdogTimer) clearTimeout(watchdogTimer);
    return result;
  };

  const waitForResultHold = async (): Promise<RollPresentationResultHoldResult> => {
    if (cancelled) return 'cancelled';
    return Promise.race<RollPresentationResultHoldResult>([
      waitForHold(Math.max(0, resultHoldMs)).then(() => 'held' as const),
      cancelledPromise.then(() => 'cancelled' as const),
    ]);
  };

  const waitForCompletion = async (): Promise<RollPresentationCompletionResult> => {
    const visualResult = await waitForVisualSettle();
    if (visualResult === 'cancelled') return 'cancelled';
    const holdResult = await waitForResultHold();
    return holdResult === 'cancelled' ? 'cancelled' : visualResult;
  };

  return {
    markSettled,
    cancel,
    waitForVisualSettle,
    waitForResultHold,
    waitForCompletion,
  };
}
