import { useEffect, type MutableRefObject } from 'react';
import type { Unsubscribe } from 'firebase/firestore';
import type { SyncedGameState } from '../../features/room/services/roomService';
import { subscribeGameState } from '../../features/room/services/roomService';
import type { SequenceStateSnapshot } from '../appState';

export function useGameSyncDebugState(diagnosticState: Record<string, unknown>) {
  useEffect(() => {
    (window as typeof window & { __YUT_DEBUG_STATE__?: Record<string, unknown> }).__YUT_DEBUG_STATE__ = diagnosticState;
  }, [diagnosticState]);
}

type GameSyncSubscriptionParams = {
  activeRoomId: string;
  lastAppliedSequenceRef: MutableRefObject<number>;
  lastAppliedStateVersionRef: MutableRefObject<number>;
  applyingSyncedStateRef: MutableRefObject<boolean>;
  replayMissingSequencesThenApply: (finalState: SequenceStateSnapshot, localSequence: number, remoteSequence: number) => Promise<void>;
  applySyncedStateSnapshot: (state: SequenceStateSnapshot) => void;
  subscribe?: (roomId: string, callback: (state: SyncedGameState | null) => void) => Unsubscribe;
};

export function useGameSyncSubscription({ activeRoomId, lastAppliedSequenceRef, lastAppliedStateVersionRef, applyingSyncedStateRef, replayMissingSequencesThenApply, applySyncedStateSnapshot, subscribe = subscribeGameState }: GameSyncSubscriptionParams) {
  useEffect(() => {
    if (!activeRoomId) return undefined;
    return subscribe(activeRoomId, (state) => {
      if (!state) return;
      const stateVersion = Number(state.turnVersion ?? 0);
      const remoteSequence = Number(state.lastSequence ?? 0);
      const localSequence = lastAppliedSequenceRef.current;
      if (stateVersion && stateVersion <= lastAppliedStateVersionRef.current) {
        if (remoteSequence > localSequence) void replayMissingSequencesThenApply(state as SequenceStateSnapshot, localSequence, remoteSequence);
        return;
      }
      applyingSyncedStateRef.current = true;
      if (remoteSequence > localSequence) {
        void replayMissingSequencesThenApply(state as SequenceStateSnapshot, localSequence, remoteSequence).finally(() => {
          window.setTimeout(() => { applyingSyncedStateRef.current = false; }, 0);
        });
      } else {
        applySyncedStateSnapshot(state as SequenceStateSnapshot);
        window.setTimeout(() => { applyingSyncedStateRef.current = false; }, 0);
      }
    });
  }, [activeRoomId, lastAppliedSequenceRef, lastAppliedStateVersionRef, applyingSyncedStateRef, subscribe]);
}
