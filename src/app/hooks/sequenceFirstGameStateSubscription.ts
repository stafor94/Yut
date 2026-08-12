import type { Unsubscribe } from 'firebase/firestore';
import {
  getLatestGameState,
  getRoom,
  subscribeGameSequences,
  type GameSequence,
  type GameSequenceSnapshotMeta,
  type RoomSummary,
  type SyncedGameState,
} from '../../features/room/services/roomService';
import { publishGameConnectionState } from './gameConnectionState';
import { advanceSequenceFirstState } from './sequenceFirstGameState';

const SERVER_CHECK_INDICATOR_DELAY_MS = 1_200;
const RECONNECT_RETRY_MS = 1_000;

type RoomStartRevision = Pick<RoomSummary, 'startRequestVersion' | 'startRequestId'>;

type SequenceFirstDependencies = {
  getLatestState: (roomId: string) => Promise<SyncedGameState | null>;
  getCurrentRoomStart: (roomId: string) => Promise<RoomStartRevision | null>;
  subscribeSequences: (
    roomId: string,
    afterSequence: number,
    callback: (sequences: GameSequence[], meta?: GameSequenceSnapshotMeta) => void,
    onError?: (error: Error) => void,
  ) => Unsubscribe;
  setTimeout: (
    callback: () => void,
    delayMs: number,
  ) => ReturnType<typeof globalThis.setTimeout>;
  clearTimeout: (timer: ReturnType<typeof globalThis.setTimeout>) => void;
};

const defaultDependencies: SequenceFirstDependencies = {
  getLatestState: getLatestGameState,
  getCurrentRoomStart: async (roomId) => getRoom(roomId),
  subscribeSequences: subscribeGameSequences,
  setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  clearTimeout: (timer) => globalThis.clearTimeout(timer),
};

const getStartRevisionKey = (value: RoomStartRevision | SyncedGameState | null | undefined) => {
  const version = Number(value?.startRequestVersion ?? 0);
  const requestId = String(value?.startRequestId ?? '');
  return Number.isFinite(version) && version > 0 && requestId ? `${Math.trunc(version)}:${requestId}` : '';
};

export const matchesCurrentRoomStartRevision = (
  roomStart: RoomStartRevision | null,
  state: SyncedGameState | null,
) => {
  if (!state) return false;
  const roomStartKey = getStartRevisionKey(roomStart);
  if (!roomStartKey) return true;
  return getStartRevisionKey(state) === roomStartKey;
};

const getBrowserRuntime = () => globalThis as typeof globalThis & {
  navigator?: { onLine?: boolean };
  addEventListener?: (type: string, listener: () => void) => void;
  removeEventListener?: (type: string, listener: () => void) => void;
};

export function createSequenceFirstGameStateSubscriber(dependencies: SequenceFirstDependencies = defaultDependencies) {
  return (roomId: string, callback: (state: SyncedGameState | null) => void): Unsubscribe => {
    let disposed = false;
    let currentState: SyncedGameState | null = null;
    let unsubscribeSequences: Unsubscribe = () => undefined;
    let retryTimer: ReturnType<typeof globalThis.setTimeout> | null = null;
    let checkingTimer: ReturnType<typeof globalThis.setTimeout> | null = dependencies.setTimeout(() => {
      checkingTimer = null;
      if (!disposed) publishGameConnectionState({ roomId, status: 'server-checking' });
    }, SERVER_CHECK_INDICATOR_DELAY_MS);

    const clearRetryTimer = () => {
      if (retryTimer === null) return;
      dependencies.clearTimeout(retryTimer);
      retryTimer = null;
    };
    const clearCheckingTimer = () => {
      if (checkingTimer === null) return;
      dependencies.clearTimeout(checkingTimer);
      checkingTimer = null;
    };
    const confirmServer = (meta?: GameSequenceSnapshotMeta) => {
      if (meta?.fromCache || meta?.hasPendingWrites) {
        publishGameConnectionState({
          roomId,
          status: getBrowserRuntime().navigator?.onLine === false ? 'offline' : 'server-checking',
          hasPendingWrites: Boolean(meta?.hasPendingWrites),
        });
        return;
      }
      clearCheckingTimer();
      publishGameConnectionState({
        roomId,
        status: 'online',
        lastServerConfirmedAt: Date.now(),
        hasPendingWrites: false,
      });
    };
    const readCurrentRevisionState = async () => {
      const [latestState, roomStart] = await Promise.all([
        dependencies.getLatestState(roomId),
        dependencies.getCurrentRoomStart(roomId),
      ]);
      if (disposed) return { status: 'disposed' as const, state: null };
      if (!latestState) return { status: 'missing' as const, state: null };
      if (!matchesCurrentRoomStartRevision(roomStart, latestState)) {
        return { status: 'stale-start-revision' as const, state: null };
      }
      return { status: 'current' as const, state: latestState };
    };
    const recoverSnapshot = async (status: 'recovering' | 'reconnecting') => {
      publishGameConnectionState({ roomId, status });
      const result = await readCurrentRevisionState();
      if (result.status !== 'current' || !result.state) {
        if (result.status === 'stale-start-revision') {
          publishGameConnectionState({ roomId, status: 'server-checking' });
        }
        return false;
      }
      currentState = result.state;
      callback(result.state);
      publishGameConnectionState({
        roomId,
        status: 'online',
        lastServerConfirmedAt: Date.now(),
        hasPendingWrites: false,
      });
      return true;
    };
    const bindSequenceListener = (afterSequence: number) => {
      unsubscribeSequences();
      unsubscribeSequences = dependencies.subscribeSequences(roomId, afterSequence, (sequences, meta) => {
        if (disposed) return;
        confirmServer(meta);
        if (!sequences.length) return;
        const advanced = advanceSequenceFirstState(
          currentState as (SyncedGameState & Record<string, unknown>) | null,
          sequences,
        );
        if (advanced.status === 'unchanged') return;
        if (advanced.status === 'recovery-required') {
          void recoverSnapshot('recovering');
          return;
        }
        currentState = advanced.state as SyncedGameState;
        callback(currentState);
      }, () => {
        if (disposed) return;
        publishGameConnectionState({
          roomId,
          status: getBrowserRuntime().navigator?.onLine === false ? 'offline' : 'reconnecting',
        });
        clearRetryTimer();
        retryTimer = dependencies.setTimeout(() => {
          retryTimer = null;
          if (disposed) return;
          void recoverSnapshot('reconnecting').finally(() => {
            if (!disposed) bindSequenceListener(Number(currentState?.lastSequence ?? afterSequence));
          });
        }, RECONNECT_RETRY_MS);
      });
    };
    const loadInitialState = async () => {
      try {
        const result = await readCurrentRevisionState();
        if (result.status === 'disposed') return;
        if (result.status === 'stale-start-revision') {
          publishGameConnectionState({ roomId, status: 'server-checking' });
          clearRetryTimer();
          retryTimer = dependencies.setTimeout(() => {
            retryTimer = null;
            if (!disposed) void loadInitialState();
          }, RECONNECT_RETRY_MS);
          return;
        }
        currentState = result.state;
        callback(result.state);
        bindSequenceListener(Number(result.state?.lastSequence ?? 0));
      } catch {
        if (disposed) return;
        callback(null);
        bindSequenceListener(0);
      }
    };

    void loadInitialState();

    const handleOffline = () => {
      if (!disposed) publishGameConnectionState({ roomId, status: 'offline' });
    };
    const handleOnline = () => {
      if (disposed) return;
      void recoverSnapshot('reconnecting');
    };
    const browserRuntime = getBrowserRuntime();
    browserRuntime.addEventListener?.('offline', handleOffline);
    browserRuntime.addEventListener?.('online', handleOnline);

    return () => {
      disposed = true;
      clearCheckingTimer();
      clearRetryTimer();
      unsubscribeSequences();
      browserRuntime.removeEventListener?.('offline', handleOffline);
      browserRuntime.removeEventListener?.('online', handleOnline);
    };
  };
}

export const subscribeSequenceFirstGameState = createSequenceFirstGameStateSubscriber();
