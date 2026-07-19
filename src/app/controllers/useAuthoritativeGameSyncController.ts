import { useCallback, useEffect, useRef, useState } from 'react';
import { commitAuthoritativeGameAction, type GameAction } from '../../features/room/services/roomService';
import type { SequenceStateSnapshot } from '../appState';
import { useGameSyncSubscription } from '../hooks/useGameSync';
import { createAuthoritativeGameActionQueues } from '../flows/authoritativeGameSyncFlow';

export type AuthoritativeCommitResult = Awaited<ReturnType<typeof commitAuthoritativeGameAction>>;

type RemoteActionType = GameAction['type'];
type PendingMeta = { type?: RemoteActionType; actorId?: string; createdSequence?: number; createdTurnIndex?: number; optimisticApplied?: boolean };
type SnapshotApplyOptions = { allowMoveAnimation?: boolean; allowRollAnimation?: boolean; updateVersion?: boolean; updateSequence?: boolean };

type Params = {
  activeRoomId: string;
  activeRoomIdRef: React.MutableRefObject<string>;
  lastAppliedSequenceRef: React.MutableRefObject<number>;
  lastAppliedStateVersionRef: React.MutableRefObject<number>;
  applyingSyncedStateRef: React.MutableRefObject<boolean>;
  replayMissingSequencesThenApply: (finalState: SequenceStateSnapshot, localSequence: number, remoteSequence: number) => Promise<void>;
  applySyncedStateSnapshot: (state: SequenceStateSnapshot, options?: SnapshotApplyOptions) => void;
  applyAuthoritativeResultSequence: (result: AuthoritativeCommitResult) => Promise<unknown>;
  syncLatestAuthoritativeState: (reason: string, options?: { allowRollAnimation?: boolean; diagnosticType?: 'roll_yut' | 'move_piece' }) => Promise<boolean>;
  syncLatestSequencesFromBadge: () => Promise<void>;
  reconcilePendingLocalRemoteActions: (options?: { forceStaleClear?: boolean }) => Promise<boolean>;
  onSnapshotReceived?: () => void;
  addPendingLocalRemoteAction: (actionKey: string, metadata?: PendingMeta) => void;
  acknowledgePendingLocalRemoteAction: (clientMutationId: unknown) => void;
  removeSettledPendingLocalRemoteAction: (actionKey: string) => void;
  clearPendingLocalRemoteActions: () => void;
  hasPendingCurrentTurnAction: (type: RemoteActionType, actorId?: string) => boolean;
  pendingLocalRemoteActionCount: number;
};

const isSequenceStateSnapshot = (value: unknown): value is SequenceStateSnapshot => Boolean(value && typeof value === 'object');

export function useAuthoritativeGameSyncController(params: Params) {
  const applySyncedStateSnapshotRef = useRef(params.applySyncedStateSnapshot);
  applySyncedStateSnapshotRef.current = params.applySyncedStateSnapshot;

  const authoritativeApplyWakeTimerRef = useRef<number | null>(null);
  const clearAuthoritativeApplyWake = useCallback(() => {
    if (authoritativeApplyWakeTimerRef.current === null) return;
    window.clearTimeout(authoritativeApplyWakeTimerRef.current);
    authoritativeApplyWakeTimerRef.current = null;
  }, []);
  const scheduleAuthoritativeApplyWake = useCallback((roomId: string, appliedValue: unknown) => {
    if (params.activeRoomIdRef.current !== roomId || !isSequenceStateSnapshot(appliedValue)) return;
    const appliedSequence = Number(appliedValue.lastSequence ?? 0);
    if (!appliedSequence) return;
    clearAuthoritativeApplyWake();
    authoritativeApplyWakeTimerRef.current = window.setTimeout(() => {
      authoritativeApplyWakeTimerRef.current = null;
      if (params.activeRoomIdRef.current !== roomId || appliedSequence < params.lastAppliedSequenceRef.current) return;
      applySyncedStateSnapshotRef.current({
        ...appliedValue,
        pieces: Array.isArray(appliedValue.pieces) ? appliedValue.pieces.map((piece) => ({ ...piece })) : appliedValue.pieces,
        gameSeats: Array.isArray(appliedValue.gameSeats) ? appliedValue.gameSeats.map((seat) => ({ ...seat })) : appliedValue.gameSeats,
      }, {
        allowMoveAnimation: false,
        allowRollAnimation: false,
        updateVersion: false,
        updateSequence: false,
      });
    }, 0);
  }, [clearAuthoritativeApplyWake, params.activeRoomIdRef, params.lastAppliedSequenceRef]);

  const queuesRef = useRef<ReturnType<typeof createAuthoritativeGameActionQueues<Omit<GameAction, 'id' | 'createdAt' | 'processed'>, AuthoritativeCommitResult>> | null>(null);
  if (!queuesRef.current) {
    queuesRef.current = createAuthoritativeGameActionQueues({
      activeRoomIdRef: params.activeRoomIdRef,
      commit: commitAuthoritativeGameAction,
      onApplySettled: scheduleAuthoritativeApplyWake,
    });
  }
  const [manualSequenceSyncing, setManualSequenceSyncing] = useState(false);
  const previousRoomIdRef = useRef(params.activeRoomId);

  useEffect(() => {
    if (previousRoomIdRef.current === params.activeRoomId) return;
    previousRoomIdRef.current = params.activeRoomId;
    clearAuthoritativeApplyWake();
    queuesRef.current?.reset();
    setManualSequenceSyncing(false);
    params.clearPendingLocalRemoteActions();
  }, [clearAuthoritativeApplyWake, params.activeRoomId, params.clearPendingLocalRemoteActions]);

  useEffect(() => clearAuthoritativeApplyWake, [clearAuthoritativeApplyWake]);

  useGameSyncSubscription({
    activeRoomId: params.activeRoomId,
    lastAppliedSequenceRef: params.lastAppliedSequenceRef,
    lastAppliedStateVersionRef: params.lastAppliedStateVersionRef,
    applyingSyncedStateRef: params.applyingSyncedStateRef,
    replayMissingSequencesThenApply: params.replayMissingSequencesThenApply,
    applySyncedStateSnapshot: params.applySyncedStateSnapshot,
    enqueueAuthoritativeResultApplication: (applyResult) => enqueueAuthoritativeResultApplication(params.activeRoomId, applyResult),
    onSnapshotReceived: () => {
      params.onSnapshotReceived?.();
    },
  });

  const commitQueuedAuthoritativeGameAction = useCallback((roomId: string, action: Omit<GameAction, 'id' | 'createdAt' | 'processed'>) => {
    return queuesRef.current!.commitQueuedAuthoritativeGameAction(roomId, action);
  }, []);

  const enqueueAuthoritativeResultApplication = useCallback(<T,>(roomId: string, applyResult: () => Promise<T> | T): Promise<T | null> => {
    return queuesRef.current!.enqueueAuthoritativeResultApplication(roomId, applyResult);
  }, []);

  const enqueueAuthoritativeGameAction = useCallback((
    roomId: string,
    action: Omit<GameAction, 'id' | 'createdAt' | 'processed'>,
    handleResult: (result: AuthoritativeCommitResult) => Promise<void> | void,
    handleError: (error: unknown) => void,
    handleFinally: () => void,
  ) => {
    queuesRef.current!.enqueueAuthoritativeGameAction(roomId, action, { handleResult, handleError, handleFinally });
  }, []);

  return {
    commitQueuedAuthoritativeGameAction,
    enqueueAuthoritativeResultApplication,
    enqueueAuthoritativeGameAction,
    applyAuthoritativeResultSequence: params.applyAuthoritativeResultSequence,
    syncLatestAuthoritativeState: params.syncLatestAuthoritativeState,
    syncLatestSequencesFromBadge: params.syncLatestSequencesFromBadge,
    reconcilePendingLocalRemoteActions: params.reconcilePendingLocalRemoteActions,
    addPendingLocalRemoteAction: params.addPendingLocalRemoteAction,
    acknowledgePendingLocalRemoteAction: params.acknowledgePendingLocalRemoteAction,
    removeSettledPendingLocalRemoteAction: params.removeSettledPendingLocalRemoteAction,
    clearPendingLocalRemoteActions: params.clearPendingLocalRemoteActions,
    hasPendingCurrentTurnAction: params.hasPendingCurrentTurnAction,
    pendingLocalRemoteActionCount: params.pendingLocalRemoteActionCount,
    manualSequenceSyncing,
    setManualSequenceSyncing,
  };
}
