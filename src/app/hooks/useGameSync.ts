import { useEffect, useRef, type MutableRefObject } from 'react';
import type { Unsubscribe } from 'firebase/firestore';
import type { SyncedGameState } from '../../features/room/services/roomService';
import { subscribeGameState } from '../../features/room/services/roomService';
import type { SequenceStateSnapshot } from '../appState';
import {
  createGameSyncSubscriptionController,
  type GameSyncRuntime,
  type GameSyncSubscriptionController,
} from './gameSyncSubscription';

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
  const subscribeRef = useRef(subscribe);
  subscribeRef.current = subscribe;

  const controllerRef = useRef<GameSyncSubscriptionController<SyncedGameState> | null>(null);
  if (!controllerRef.current) controllerRef.current = createGameSyncSubscriptionController<SyncedGameState>();

  const runtimeRef = useRef<GameSyncRuntime<SyncedGameState> | null>(null);
  runtimeRef.current = {
    activeRoomId,
    lastAppliedSequenceRef,
    lastAppliedStateVersionRef,
    applyingSyncedStateRef,
    replayMissingSequencesThenApply: (state, localSequence, remoteSequence) => replayMissingSequencesThenApply(state as SequenceStateSnapshot, localSequence, remoteSequence),
    applySyncedStateSnapshot: (state) => applySyncedStateSnapshot(state as SequenceStateSnapshot),
    enqueueAuthoritativeResultApplication,
    scheduleApplyingReset: (reset) => { window.setTimeout(reset, 0); },
  };
  controllerRef.current.updateRuntime(runtimeRef.current);

  useEffect(() => {
    const controller = controllerRef.current;
    const runtime = runtimeRef.current;
    if (!controller || !runtime) return;
    controller.updateRuntime(runtime);
    controller.syncRoom(activeRoomId, subscribeRef.current);
  }, [activeRoomId]);

  useEffect(() => () => {
    controllerRef.current?.dispose();
  }, []);
}
