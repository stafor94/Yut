import { notifySequenceRecoveryProgress } from './sequenceRecoveryWatchdog';

export type MutableValueRef<T> = { current: T };

export type GameSyncRuntime<TState> = {
  activeRoomId: string;
  lastAppliedSequenceRef: MutableValueRef<number>;
  lastAppliedStateVersionRef: MutableValueRef<number>;
  applyingSyncedStateRef: MutableValueRef<boolean>;
  replayMissingSequencesThenApply: (finalState: TState, localSequence: number, remoteSequence: number) => Promise<void>;
  applySyncedStateSnapshot: (state: TState) => void;
  enqueueAuthoritativeResultApplication: (applyResult: () => Promise<void> | void) => Promise<void | null>;
  scheduleApplyingReset: (reset: () => void) => void;
  onSnapshotReceived?: (state: TState) => void;
};

export type GameStateSubscriber<TState> = (
  roomId: string,
  callback: (state: TState | null) => void,
) => () => void;

export type GameSyncSnapshotIdentity = {
  turnVersion?: unknown;
  lastSequence?: unknown;
  lastClientMutationId?: unknown;
  updatedAt?: unknown;
  startRequestVersion?: unknown;
  startRequestId?: unknown;
  startCountdownEndsAt?: unknown;
};

export type GameSyncSubscriptionController<TState extends GameSyncSnapshotIdentity> = {
  updateRuntime: (runtime: GameSyncRuntime<TState>) => void;
  syncRoom: (roomId: string, subscribe: GameStateSubscriber<TState>) => void;
  dispose: () => void;
};

const toFiniteNumber = (value: unknown) => {
  const numericValue = Number(value ?? 0);
  return Number.isFinite(numericValue) ? numericValue : 0;
};

const normalizeSnapshotValue = (value: unknown, seen: WeakSet<object>): unknown => {
  if (value === null || typeof value !== 'object') return value;
  if ('toMillis' in value && typeof value.toMillis === 'function') {
    const millis = Number(value.toMillis());
    return Number.isFinite(millis) ? { __timestampMillis: millis } : { __timestampMillis: 0 };
  }
  if (value instanceof Date) return { __dateMillis: value.getTime() };
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => normalizeSnapshotValue(item, seen));
  return Object.keys(value)
    .sort()
    .reduce<Record<string, unknown>>((normalized, key) => {
      normalized[key] = normalizeSnapshotValue((value as Record<string, unknown>)[key], seen);
      return normalized;
    }, {});
};

const stableSnapshotString = (state: unknown) => JSON.stringify(normalizeSnapshotValue(state, new WeakSet<object>()));

const hashSnapshotString = (value: string) => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
};

const yieldToNextTask = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

export function getGameSyncSnapshotApplyKey(state: GameSyncSnapshotIdentity) {
  const stateVersion = toFiniteNumber(state.turnVersion);
  const sequence = toFiniteNumber(state.lastSequence);
  if (stateVersion > 0) return `version:${stateVersion}:sequence:${sequence}`;

  const mutationId = typeof state.lastClientMutationId === 'string' ? state.lastClientMutationId : '';
  return `legacy:sequence:${sequence}:mutation:${mutationId}:payload:${hashSnapshotString(stableSnapshotString(state))}`;
}

export function createGameSyncSubscriptionController<TState extends GameSyncSnapshotIdentity>(): GameSyncSubscriptionController<TState> {
  let runtime: GameSyncRuntime<TState> | null = null;
  let subscribedRoomId = '';
  let unsubscribe: (() => void) | null = null;
  let applyingOperationCount = 0;
  const appliedSnapshotKeys = new Set<string>();
  const pendingSnapshotKeys = new Set<string>();
  const deferredPreparedSnapshots = new Map<string, { roomId: string; state: TState }>();
  const deferredPreparedSnapshotTimers = new Map<string, ReturnType<typeof setTimeout>>();

  const rememberAppliedSnapshotKey = (snapshotKey: string) => {
    appliedSnapshotKeys.add(snapshotKey);
    if (appliedSnapshotKeys.size <= 64) return;
    const oldestKey = appliedSnapshotKeys.values().next().value;
    if (typeof oldestKey === 'string') appliedSnapshotKeys.delete(oldestKey);
  };

  const clearDeferredPreparedSnapshots = () => {
    deferredPreparedSnapshotTimers.forEach((timer) => clearTimeout(timer));
    deferredPreparedSnapshotTimers.clear();
    deferredPreparedSnapshots.clear();
  };

  const isCurrentRoom = (roomId: string) => Boolean(roomId && subscribedRoomId === roomId && runtime?.activeRoomId === roomId);

  const handleSnapshot = async (roomId: string, state: TState | null) => {
    if (!state || !isCurrentRoom(roomId)) return;

    const startRequestVersion = toFiniteNumber(state.startRequestVersion);
    const startRequestId = typeof state.startRequestId === 'string' ? state.startRequestId : '';
    const countdownEndsAt = toFiniteNumber(state.startCountdownEndsAt);
    const preparedStartKey = startRequestVersion && startRequestId && countdownEndsAt
      ? `${roomId}:${startRequestVersion}:${startRequestId}`
      : '';
    if (preparedStartKey && Date.now() < countdownEndsAt) {
      deferredPreparedSnapshots.set(preparedStartKey, { roomId, state });
      if (!deferredPreparedSnapshotTimers.has(preparedStartKey)) {
        const timer = setTimeout(() => {
          deferredPreparedSnapshotTimers.delete(preparedStartKey);
          const deferred = deferredPreparedSnapshots.get(preparedStartKey);
          deferredPreparedSnapshots.delete(preparedStartKey);
          if (deferred) void handleSnapshot(deferred.roomId, deferred.state);
        }, Math.max(0, countdownEndsAt - Date.now()));
        deferredPreparedSnapshotTimers.set(preparedStartKey, timer);
      }
      return;
    }

    notifySequenceRecoveryProgress(roomId, toFiniteNumber(state.lastSequence));
    runtime?.onSnapshotReceived?.(state);
    const snapshotKey = getGameSyncSnapshotApplyKey(state);
    const scopedSnapshotKey = `${roomId}:${snapshotKey}`;
    if (appliedSnapshotKeys.has(snapshotKey) || pendingSnapshotKeys.has(scopedSnapshotKey)) return;
    pendingSnapshotKeys.add(scopedSnapshotKey);

    try {
      const currentRuntime = runtime;
      if (!currentRuntime || !isCurrentRoom(roomId)) return;
      await currentRuntime.enqueueAuthoritativeResultApplication(async () => {
        const latestRuntime = runtime;
        if (!latestRuntime || !isCurrentRoom(roomId)) return;

        const stateVersion = toFiniteNumber(state.turnVersion);
        const remoteSequence = toFiniteNumber(state.lastSequence);
        const localSequence = latestRuntime.lastAppliedSequenceRef.current;
        const localStateVersion = latestRuntime.lastAppliedStateVersionRef.current;
        if (stateVersion > 0 && stateVersion <= localStateVersion && remoteSequence <= localSequence) {
          rememberAppliedSnapshotKey(snapshotKey);
          return;
        }

        applyingOperationCount += 1;
        const applyingRef = latestRuntime.applyingSyncedStateRef;
        applyingRef.current = true;
        try {
          if (remoteSequence > localSequence) {
            let replayFromSequence = localSequence;
            while (replayFromSequence < remoteSequence && isCurrentRoom(roomId)) {
              const replayTargetSequence = replayFromSequence > 0
                ? Math.min(remoteSequence, replayFromSequence + 1)
                : remoteSequence;
              await latestRuntime.replayMissingSequencesThenApply(state, replayFromSequence, replayTargetSequence);
              const appliedSequence = Math.min(remoteSequence, latestRuntime.lastAppliedSequenceRef.current);
              if (appliedSequence <= replayFromSequence) break;
              replayFromSequence = appliedSequence;
              if (replayFromSequence < remoteSequence) await yieldToNextTask();
            }
          } else {
            latestRuntime.applySyncedStateSnapshot(state);
          }
          if (isCurrentRoom(roomId)) rememberAppliedSnapshotKey(snapshotKey);
        } finally {
          latestRuntime.scheduleApplyingReset(() => {
            applyingOperationCount = Math.max(0, applyingOperationCount - 1);
            applyingRef.current = false;
            if (runtime?.applyingSyncedStateRef) runtime.applyingSyncedStateRef.current = applyingOperationCount > 0;
          });
        }
      });
    } finally {
      pendingSnapshotKeys.delete(scopedSnapshotKey);
    }
  };

  return {
    updateRuntime(nextRuntime) {
      runtime = nextRuntime;
    },
    syncRoom(roomId, subscribe) {
      if (roomId === subscribedRoomId) return;
      unsubscribe?.();
      unsubscribe = null;
      subscribedRoomId = roomId;
      appliedSnapshotKeys.clear();
      pendingSnapshotKeys.clear();
      clearDeferredPreparedSnapshots();
      if (!roomId) return;
      unsubscribe = subscribe(roomId, (state) => {
        void handleSnapshot(roomId, state);
      });
    },
    dispose() {
      unsubscribe?.();
      unsubscribe = null;
      subscribedRoomId = '';
      appliedSnapshotKeys.clear();
      pendingSnapshotKeys.clear();
      clearDeferredPreparedSnapshots();
      applyingOperationCount = 0;
      if (runtime) runtime.applyingSyncedStateRef.current = false;
      runtime = null;
    },
  };
}
