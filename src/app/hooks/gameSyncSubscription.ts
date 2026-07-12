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

export function getGameSyncSnapshotApplyKey(state: GameSyncSnapshotIdentity) {
  const stateVersion = toFiniteNumber(state.turnVersion);
  const sequence = toFiniteNumber(state.lastSequence);
  if (stateVersion > 0) return `version:${stateVersion}:sequence:${sequence}`;

  const mutationId = typeof state.lastClientMutationId === 'string' ? state.lastClientMutationId : '';
  return `legacy:sequence:${sequence}:mutation:${mutationId}:payload:${stableSnapshotString(state)}`;
}

export function createGameSyncSubscriptionController<TState extends GameSyncSnapshotIdentity>(): GameSyncSubscriptionController<TState> {
  let runtime: GameSyncRuntime<TState> | null = null;
  let subscribedRoomId = '';
  let unsubscribe: (() => void) | null = null;
  let lastAppliedSnapshotKey = '';
  let applyingOperationCount = 0;
  const pendingSnapshotKeys = new Set<string>();

  const isCurrentRoom = (roomId: string) => Boolean(roomId && subscribedRoomId === roomId && runtime?.activeRoomId === roomId);

  const handleSnapshot = async (roomId: string, state: TState | null) => {
    if (!state || !isCurrentRoom(roomId)) return;
    const snapshotKey = getGameSyncSnapshotApplyKey(state);
    const scopedSnapshotKey = `${roomId}:${snapshotKey}`;
    if (lastAppliedSnapshotKey === snapshotKey || pendingSnapshotKeys.has(scopedSnapshotKey)) return;
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
          lastAppliedSnapshotKey = snapshotKey;
          return;
        }

        applyingOperationCount += 1;
        const applyingRef = latestRuntime.applyingSyncedStateRef;
        applyingRef.current = true;
        try {
          if (remoteSequence > localSequence) {
            await latestRuntime.replayMissingSequencesThenApply(state, localSequence, remoteSequence);
          } else {
            latestRuntime.applySyncedStateSnapshot(state);
          }
          if (isCurrentRoom(roomId)) lastAppliedSnapshotKey = snapshotKey;
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
      lastAppliedSnapshotKey = '';
      pendingSnapshotKeys.clear();
      if (!roomId) return;
      unsubscribe = subscribe(roomId, (state) => {
        void handleSnapshot(roomId, state);
      });
    },
    dispose() {
      unsubscribe?.();
      unsubscribe = null;
      subscribedRoomId = '';
      lastAppliedSnapshotKey = '';
      pendingSnapshotKeys.clear();
      applyingOperationCount = 0;
      if (runtime) runtime.applyingSyncedStateRef.current = false;
      runtime = null;
    },
  };
}
