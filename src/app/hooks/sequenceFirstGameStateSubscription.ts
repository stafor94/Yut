import type { Unsubscribe } from 'firebase/firestore';
import {
  getLatestGameState,
  subscribeGameSequences,
  type GameSequence,
  type GameSequenceSnapshotMeta,
  type SyncedGameState,
} from '../../features/room/services/roomService';
import { publishGameConnectionState } from './gameConnectionState';
import { advanceSequenceFirstState } from './sequenceFirstGameState';

const SERVER_CHECK_INDICATOR_DELAY_MS = 1_200;
const RECONNECT_RETRY_MS = 1_000;

type SequenceFirstDependencies = {
  getLatestState: (roomId: string) => Promise<SyncedGameState | null>;
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
  subscribeSequences: subscribeGameSequences,
  setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  clearTimeout: (timer) => globalThis.clearTimeout(timer),
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
    const recoverSnapshot = async (status: 'recovering' | 'reconnecting') => {
      publishGameConnectionState({ roomId, status });
      const latestState = await dependencies.getLatestState(roomId);
      if (disposed) return false;
      if (!latestState) return false;
      currentState = latestState;
      callback(latestState);
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

    void dependencies.getLatestState(roomId).then((initialState) => {
      if (disposed) return;
      currentState = initialState;
      callback(initialState);
      bindSequenceListener(Number(initialState?.lastSequence ?? 0));
    }).catch(() => {
      if (disposed) return;
      callback(null);
      bindSequenceListener(0);
    });

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
