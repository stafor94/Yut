import { useEffect, useRef, type MutableRefObject } from 'react';
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
  enqueueAuthoritativeResultApplication: (applyResult: () => Promise<void> | void) => Promise<void | null>;
  subscribe?: (roomId: string, callback: (state: SyncedGameState | null) => void) => Unsubscribe;
};

export function useGameSyncSubscription({ activeRoomId, lastAppliedSequenceRef, lastAppliedStateVersionRef, applyingSyncedStateRef, replayMissingSequencesThenApply, applySyncedStateSnapshot, enqueueAuthoritativeResultApplication, subscribe = subscribeGameState }: GameSyncSubscriptionParams) {
  const latestCallbacksRef = useRef({ replayMissingSequencesThenApply, applySyncedStateSnapshot });
  useEffect(() => {
    latestCallbacksRef.current = { replayMissingSequencesThenApply, applySyncedStateSnapshot };
  }, [replayMissingSequencesThenApply, applySyncedStateSnapshot]);

  useEffect(() => {
    if (!activeRoomId) return undefined;
    return subscribe(activeRoomId, (state) => {
      if (!state) return;
      void enqueueAuthoritativeResultApplication(async () => {
        const stateVersion = Number(state.turnVersion ?? 0);
        const remoteSequence = Number(state.lastSequence ?? 0);
        const localSequence = lastAppliedSequenceRef.current;
        const localStateVersion = lastAppliedStateVersionRef.current;
        if (stateVersion && stateVersion <= localStateVersion && remoteSequence <= localSequence) return;
        applyingSyncedStateRef.current = true;
        try {
          if (remoteSequence > localSequence) {
            await latestCallbacksRef.current.replayMissingSequencesThenApply(state as SequenceStateSnapshot, localSequence, remoteSequence);
          } else {
            latestCallbacksRef.current.applySyncedStateSnapshot(state as SequenceStateSnapshot);
          }
        } finally {
          window.setTimeout(() => { applyingSyncedStateRef.current = false; }, 0);
        }
      });
    });
  }, [activeRoomId, lastAppliedSequenceRef, lastAppliedStateVersionRef, applyingSyncedStateRef, enqueueAuthoritativeResultApplication, subscribe]);
}
