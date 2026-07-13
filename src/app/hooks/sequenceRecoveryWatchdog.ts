export type SequenceRecoveryCheckResult = 'changed' | 'unchanged' | 'failed' | 'deferred';

export type SequenceRecoveryScheduler = {
  now: () => number;
  setTimeout: (callback: () => void, delayMs: number) => number;
  clearTimeout: (timerId: number) => void;
};

export type SequenceRecoveryConflictState = {
  sequenceReplayInProgress: boolean;
  moveInProgress: boolean;
  applyingSyncedState: boolean;
  manualSequenceSyncing: boolean;
  hasPendingRemoteActions: boolean;
  turnRecoveryInFlight: boolean;
};

export const SEQUENCE_RECOVERY_HARD_EVENT = 'yut:sequence-hard-recovery';
export const SEQUENCE_RECOVERY_FATAL_EVENT = 'yut:sequence-fatal-stall';

export type SequenceRecoveryEscalationDetail = {
  roomId: string;
  watchKey: string;
  elapsedMs: number;
};

export function shouldDeferSequenceRecovery(state: SequenceRecoveryConflictState) {
  return state.sequenceReplayInProgress
    || state.moveInProgress
    || state.applyingSyncedState
    || state.manualSequenceSyncing
    || state.hasPendingRemoteActions
    || state.turnRecoveryInFlight;
}

export type SequenceRecoveryWatchdogController = {
  update: (state: { active: boolean; key: string }) => void;
  notifySnapshot: () => void;
  notifySequence: (sequence: number) => void;
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
  softRecoveryAfterMs?: number;
  hardRecoveryAfterMs?: number;
  fatalRecoveryAfterMs?: number;
  fatalDeferredRetryMs?: number;
  onCheckStarted?: (attempt: number) => void;
  onHardRecovery?: (detail: SequenceRecoveryEscalationDetail) => void;
  onFatalRecovery?: (detail: SequenceRecoveryEscalationDetail) => void;
};

type SequenceProgressListener = (roomId: string, sequence: number) => void;
const sequenceProgressListeners = new Set<SequenceProgressListener>();

export function notifySequenceRecoveryProgress(roomId: string, sequence: number) {
  if (!roomId || !Number.isFinite(sequence) || sequence < 0) return;
  sequenceProgressListeners.forEach((listener) => listener(roomId, sequence));
}

const dispatchEscalationEvent = (eventName: string, detail: SequenceRecoveryEscalationDetail) => {
  const target = globalThis as unknown as {
    dispatchEvent?: (event: unknown) => boolean;
    CustomEvent?: new (type: string, init?: { detail?: unknown }) => unknown;
  };
  if (!target.dispatchEvent || !target.CustomEvent) return;
  target.dispatchEvent(new target.CustomEvent(eventName, { detail }));
};

const getRoomIdFromWatchKey = (watchKey: string) => watchKey.split(':', 1)[0] ?? '';

export function createSequenceRecoveryWatchdog(options: SequenceRecoveryWatchdogOptions): SequenceRecoveryWatchdogController {
  const {
    runCheck,
    scheduler,
    onCheckStarted,
    onHardRecovery = (detail) => dispatchEscalationEvent(SEQUENCE_RECOVERY_HARD_EVENT, detail),
    onFatalRecovery = (detail) => dispatchEscalationEvent(SEQUENCE_RECOVERY_FATAL_EVENT, detail),
  } = options;
  void options.initialDelayMs;
  void options.retryDelaysMs;
  void options.maxAttempts;
  void options.maxTotalMs;

  const softRecoveryAfterMs = Math.max(1, options.softRecoveryAfterMs ?? 30_000);
  const hardRecoveryAfterMs = Math.max(softRecoveryAfterMs, options.hardRecoveryAfterMs ?? 60_000);
  const fatalRecoveryAfterMs = Math.max(hardRecoveryAfterMs, options.fatalRecoveryAfterMs ?? 120_000);
  const fatalDeferredRetryMs = Math.max(1, options.fatalDeferredRetryMs ?? 5_000);

  let active = false;
  let watchKey = '';
  let roomId = '';
  let timerId: number | null = null;
  let inFlight = false;
  let attemptCount = 0;
  let cycleStartedAt = 0;
  let lastObservedSequence = -1;
  let softRecoveryStarted = false;
  let hardRecoveryStarted = false;
  let fatalRecoveryStarted = false;
  let generation = 0;
  let rescheduleAfterFlight = false;

  const clearScheduled = () => {
    if (timerId === null) return;
    scheduler.clearTimeout(timerId);
    timerId = null;
  };

  const getElapsedMs = () => Math.max(0, scheduler.now() - cycleStartedAt);

  const makeDetail = (): SequenceRecoveryEscalationDetail => ({
    roomId,
    watchKey,
    elapsedMs: getElapsedMs(),
  });

  const getNextThreshold = () => {
    if (!softRecoveryStarted) return softRecoveryAfterMs;
    if (!hardRecoveryStarted) return hardRecoveryAfterMs;
    if (!fatalRecoveryStarted) return fatalRecoveryAfterMs;
    return null;
  };

  const scheduleNext = () => {
    clearScheduled();
    if (!active || inFlight) {
      if (active && inFlight) rescheduleAfterFlight = true;
      return;
    }
    const threshold = getNextThreshold();
    if (threshold === null) return;
    const delayMs = Math.max(0, cycleStartedAt + threshold - scheduler.now());
    timerId = scheduler.setTimeout(() => {
      timerId = null;
      void runDueStage();
    }, delayMs);
  };

  const resetCycle = (sequence?: number) => {
    generation += 1;
    cycleStartedAt = scheduler.now();
    attemptCount = 0;
    softRecoveryStarted = false;
    hardRecoveryStarted = false;
    fatalRecoveryStarted = false;
    if (typeof sequence === 'number' && Number.isFinite(sequence)) lastObservedSequence = sequence;
    clearScheduled();
    if (inFlight) rescheduleAfterFlight = true;
    else scheduleNext();
  };

  const executeCheck = async (): Promise<SequenceRecoveryCheckResult> => {
    if (!active || inFlight) return 'deferred';
    const checkGeneration = generation;
    inFlight = true;
    rescheduleAfterFlight = false;
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

    if (!active) return 'deferred';
    if (generation !== checkGeneration) {
      if (rescheduleAfterFlight) {
        rescheduleAfterFlight = false;
        scheduleNext();
      }
      return 'changed';
    }
    if (result === 'changed') {
      resetCycle();
      return result;
    }
    if (rescheduleAfterFlight) {
      rescheduleAfterFlight = false;
      scheduleNext();
    }
    return result;
  };

  const runDueStage = async () => {
    if (!active || inFlight) return;
    const elapsedMs = getElapsedMs();

    if (!softRecoveryStarted && elapsedMs >= softRecoveryAfterMs) {
      softRecoveryStarted = true;
      const result = await executeCheck();
      if (result !== 'changed') scheduleNext();
      return;
    }

    if (!hardRecoveryStarted && elapsedMs >= hardRecoveryAfterMs) {
      hardRecoveryStarted = true;
      onHardRecovery(makeDetail());
      const result = await executeCheck();
      if (result !== 'changed') scheduleNext();
      return;
    }

    if (!fatalRecoveryStarted && elapsedMs >= fatalRecoveryAfterMs) {
      const result = await executeCheck();
      if (result === 'changed') return;
      if (result === 'deferred') {
        cycleStartedAt += fatalDeferredRetryMs;
        scheduleNext();
        return;
      }
      fatalRecoveryStarted = true;
      onFatalRecovery(makeDetail());
      return;
    }

    scheduleNext();
  };

  const stop = () => {
    generation += 1;
    active = false;
    watchKey = '';
    roomId = '';
    rescheduleAfterFlight = false;
    clearScheduled();
    attemptCount = 0;
    cycleStartedAt = 0;
    lastObservedSequence = -1;
    softRecoveryStarted = false;
    hardRecoveryStarted = false;
    fatalRecoveryStarted = false;
  };

  const notifySequence = (sequence: number) => {
    if (!active || !Number.isFinite(sequence) || sequence < 0) return;
    if (lastObservedSequence < 0) {
      lastObservedSequence = sequence;
      resetCycle(sequence);
      return;
    }
    if (sequence <= lastObservedSequence) return;
    resetCycle(sequence);
  };

  const progressListener: SequenceProgressListener = (progressRoomId, sequence) => {
    if (active && progressRoomId === roomId) notifySequence(sequence);
  };
  sequenceProgressListeners.add(progressListener);

  return {
    update(nextState) {
      if (!nextState.active || !nextState.key) {
        if (active || watchKey) stop();
        return;
      }
      const nextRoomId = getRoomIdFromWatchKey(nextState.key);
      if (active && roomId === nextRoomId) {
        watchKey = nextState.key;
        return;
      }
      generation += 1;
      active = true;
      watchKey = nextState.key;
      roomId = nextRoomId;
      cycleStartedAt = scheduler.now();
      lastObservedSequence = -1;
      attemptCount = 0;
      softRecoveryStarted = false;
      hardRecoveryStarted = false;
      fatalRecoveryStarted = false;
      rescheduleAfterFlight = false;
      clearScheduled();
      scheduleNext();
    },
    notifySnapshot() {
      // Snapshot activity alone is not progress. Only a higher lastSequence resets the watchdog.
    },
    notifySequence,
    async triggerNow() {
      if (!active || inFlight) return false;
      const result = await executeCheck();
      if (result !== 'changed') scheduleNext();
      return true;
    },
    dispose() {
      sequenceProgressListeners.delete(progressListener);
      stop();
    },
  };
}
