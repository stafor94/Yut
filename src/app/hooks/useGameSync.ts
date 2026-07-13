import { useEffect, useRef, type MutableRefObject } from 'react';
import type { Unsubscribe } from 'firebase/firestore';
import type { SyncedGameState } from '../../features/room/services/roomService';
import { subscribeGameState } from '../../features/room/services/roomService';
import { STORAGE_KEYS, type SequenceStateSnapshot } from '../appState';
import {
  createGameSyncSubscriptionController,
  type GameSyncRuntime,
  type GameSyncSubscriptionController,
} from './gameSyncSubscription';
import {
  SEQUENCE_RECOVERY_FATAL_EVENT,
  SEQUENCE_RECOVERY_HARD_EVENT,
  type SequenceRecoveryEscalationDetail,
} from './sequenceRecoveryWatchdog';

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
  onSnapshotReceived?: (state: SequenceStateSnapshot) => void;
  subscribe?: (roomId: string, callback: (state: SyncedGameState | null) => void) => Unsubscribe;
};

export function useGameSyncSubscription({ activeRoomId, lastAppliedSequenceRef, lastAppliedStateVersionRef, applyingSyncedStateRef, replayMissingSequencesThenApply, applySyncedStateSnapshot, enqueueAuthoritativeResultApplication, onSnapshotReceived, subscribe = subscribeGameState }: GameSyncSubscriptionParams) {
  const subscribeRef = useRef(subscribe);
  subscribeRef.current = subscribe;
  const activeRoomIdRef = useRef(activeRoomId);
  activeRoomIdRef.current = activeRoomId;
  const fatalRecoveryHandledRef = useRef(false);

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
    onSnapshotReceived: onSnapshotReceived ? (state) => onSnapshotReceived(state as SequenceStateSnapshot) : undefined,
    scheduleApplyingReset: (reset) => { window.setTimeout(reset, 0); },
  };
  controllerRef.current.updateRuntime(runtimeRef.current);

  useEffect(() => {
    const controller = controllerRef.current;
    const runtime = runtimeRef.current;
    if (!controller || !runtime) return;
    fatalRecoveryHandledRef.current = false;
    controller.updateRuntime(runtime);
    controller.syncRoom(activeRoomId, subscribeRef.current);
  }, [activeRoomId]);

  useEffect(() => {
    const getDetail = (event: Event) => (event as CustomEvent<SequenceRecoveryEscalationDetail>).detail;
    const handleHardRecovery = (event: Event) => {
      const detail = getDetail(event);
      const roomId = detail?.roomId ?? '';
      if (!roomId || activeRoomIdRef.current !== roomId) return;
      const controller = controllerRef.current;
      if (!controller) return;
      controller.syncRoom('', subscribeRef.current);
      const runtime = runtimeRef.current;
      if (runtime) controller.updateRuntime(runtime);
      controller.syncRoom(roomId, subscribeRef.current);
    };
    const handleFatalRecovery = (event: Event) => {
      const detail = getDetail(event);
      const roomId = detail?.roomId ?? '';
      if (!roomId || activeRoomIdRef.current !== roomId || fatalRecoveryHandledRef.current) return;
      fatalRecoveryHandledRef.current = true;
      controllerRef.current?.syncRoom('', subscribeRef.current);
      window.localStorage.removeItem(STORAGE_KEYS.activeRoomId);
      window.localStorage.removeItem(STORAGE_KEYS.isRoomHost);
      window.alert('2분 동안 서버의 게임 진행을 확인하지 못해 게임을 종료하고 로비로 이동합니다.');
      window.location.reload();
    };

    window.addEventListener(SEQUENCE_RECOVERY_HARD_EVENT, handleHardRecovery);
    window.addEventListener(SEQUENCE_RECOVERY_FATAL_EVENT, handleFatalRecovery);
    return () => {
      window.removeEventListener(SEQUENCE_RECOVERY_HARD_EVENT, handleHardRecovery);
      window.removeEventListener(SEQUENCE_RECOVERY_FATAL_EVENT, handleFatalRecovery);
    };
  }, []);

  useEffect(() => () => {
    controllerRef.current?.dispose();
  }, []);
}
