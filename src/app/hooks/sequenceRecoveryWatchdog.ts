export type SequenceRecoveryCheckResult = 'changed' | 'unchanged' | 'failed' | 'deferred';

export type SequenceRecoveryScheduler = {
  now: () => number;
  setTimeout: (callback: () => void, delayMs: number) => number;
  clearTimeout: (timerId: number) => void;
};

export type SequenceRecoveryWatchdogController = {
  update: (state: { active: boolean; key: string }) => void;
  notifySnapshot: () => void;
  triggerNow: () => Promise<boolean>;
  dispose: () => void;
};

type SequenceRecoveryWatchdogOptions = {
  runCheck: () => Promise<SequenceRecoveryCheckResult>;
  scheduler: SequenceRecoveryScheduler;
  initialDelayMs: number;
  retryDelaysMs: readonly number[];
  maxAttempts: number;
  maxTotalMs: number;
  onCheckStarted?: (attempt: number) => void;
};

export function createSequenceRecoveryWatchdog({
  runCheck,
  scheduler,
  initialDelayMs,
  retryDelaysMs,
  maxAttempts,
  maxTotalMs,
  onCheckStarted,
}: SequenceRecoveryWatchdogOptions): SequenceRecoveryWatchdogController {
  let active = false;
  let watchKey = '';
  let timerId: number | null = null;
  let inFlight = false;
  let attemptCount = 0;
  let cycleStartedAt = 0;
  let generation = 0;
  let pendingDelayMs: number | null = null;

  const clearScheduled = () => {
    if (timerId === null) return;
    scheduler.clearTimeout(timerId);
    timerId = null;
  };

  const resetCycle = () => {
    attemptCount = 0;
    cycleStartedAt = scheduler.now();
  };

  const getRetryDelay = () => {
    if (!retryDelaysMs.length) return initialDelayMs;
    return retryDelaysMs[Math.min(Math.max(0, attemptCount - 1), retryDelaysMs.length - 1)];
  };

  const schedule = (delayMs: number) => {
    clearScheduled();
    if (!active) return;
    if (inFlight) {
      pendingDelayMs = delayMs;
      return;
    }
    if (!cycleStartedAt) cycleStartedAt = scheduler.now();
    const elapsedMs = Math.max(0, scheduler.now() - cycleStartedAt);
    if (attemptCount >= maxAttempts || elapsedMs + delayMs > maxTotalMs) return;
    timerId = scheduler.setTimeout(() => {
      timerId = null;
      void runScheduledCheck();
    }, Math.max(0, delayMs));
  };

  const runScheduledCheck = async () => {
    if (!active || inFlight) return false;
    clearScheduled();
    if (!cycleStartedAt) resetCycle();
    const checkGeneration = generation;
    inFlight = true;
    pendingDelayMs = null;
    attemptCount += 1;
    onCheckStarted?.(attemptCount);

    let result: SequenceRecoveryCheckResult;
    try {
      result = await runCheck();
    } catch {
      result = 'failed';
    } finally {
      inFlight = false;
    }

    if (!active) return true;
    if (generation !== checkGeneration) {
      const nextDelay = pendingDelayMs;
      pendingDelayMs = null;
      if (nextDelay !== null) schedule(nextDelay);
      return true;
    }

    if (result === 'changed') {
      resetCycle();
      schedule(initialDelayMs);
      return true;
    }
    if (result === 'deferred') {
      attemptCount = Math.max(0, attemptCount - 1);
      schedule(initialDelayMs);
      return true;
    }

    schedule(getRetryDelay());
    return true;
  };

  const stop = () => {
    generation += 1;
    active = false;
    watchKey = '';
    pendingDelayMs = null;
    clearScheduled();
    attemptCount = 0;
    cycleStartedAt = 0;
  };

  return {
    update(nextState) {
      if (!nextState.active || !nextState.key) {
        if (active || watchKey) stop();
        return;
      }
      if (active && watchKey === nextState.key) return;
      generation += 1;
      active = true;
      watchKey = nextState.key;
      pendingDelayMs = null;
      clearScheduled();
      resetCycle();
      schedule(initialDelayMs);
    },
    notifySnapshot() {
      if (!active) return;
      generation += 1;
      clearScheduled();
      resetCycle();
      if (inFlight) pendingDelayMs = initialDelayMs;
      else schedule(initialDelayMs);
    },
    async triggerNow() {
      if (!active || inFlight) return false;
      generation += 1;
      clearScheduled();
      resetCycle();
      return runScheduledCheck();
    },
    dispose() {
      stop();
    },
  };
}
