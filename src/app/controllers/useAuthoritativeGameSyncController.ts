import { useCallback, useEffect, useRef, useState } from 'react';
import { commitAuthoritativeGameAction, withGameSequenceReplayCache, type GameAction } from '../../features/room/services/roomService';
import { attachClientActionStartedAt } from '../../features/room/services/turnActionStartedAtPolicy';
import {
  aliasTimeoutRollMutationIds,
  canonicalizeTimeoutRollAction,
  clearTimeoutRollMutationAliases,
  registerPendingTimeoutRollCandidate,
  removePendingTimeoutRollCandidate,
} from '../../features/room/services/timeoutRollActionIdentity';
import type { SequenceStateSnapshot } from '../appState';
import { useGameSyncSubscription } from '../hooks/useGameSync';
import { shouldDeferSameOrOlderSnapshotForPendingLocalMove } from '../hooks/localOptimisticSnapshotPolicy';
import { buildAuthoritativeApplyWakeSnapshot } from '../flows/authoritativeApplyWakeFlow';
import { createAuthoritativeGameActionQueues } from '../flows/authoritativeGameSyncFlow';
import { getSequenceRefetchAfter } from '../utils/sequenceRefetch';

export type AuthoritativeCommitResult = Awaited<ReturnType<typeof commitAuthoritativeGameAction>>;

type RemoteActionType = GameAction['type'];
type PendingMeta = { type?: RemoteActionType; actorId?: string; createdSequence?: number; createdTurnIndex?: number; optimisticApplied?: boolean };
type SnapshotApplyOptions = { allowMoveAnimation?: boolean; allowRollAnimation?: boolean; updateVersion?: boolean; updateSequence?: boolean };
type CommittableGameAction = Omit<GameAction, 'id' | 'createdAt' | 'processed'>;

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
  onSnapshotReceived?: (state: SequenceStateSnapshot) => void;
  addPendingLocalRemoteAction: (actionKey: string, metadata?: PendingMeta) => void;
  acknowledgePendingLocalRemoteAction: (clientMutationId: unknown) => void;
  removeSettledPendingLocalRemoteAction: (actionKey: string) => void;
  clearPendingLocalRemoteActions: () => void;
  hasPendingCurrentTurnAction: (type: RemoteActionType, actorId?: string) => boolean;
  pendingLocalRemoteActionCount: number;
};

const isTimedOutRollAction = (action: CommittableGameAction) => (
  action.type === 'roll_yut'
  && Boolean(action.payload && typeof action.payload === 'object' && (action.payload as Record<string, unknown>).timedOut === true)
);

export function useAuthoritativeGameSyncController(params: Params) {
  const applySyncedStateSnapshotRef = useRef(params.applySyncedStateSnapshot);
  applySyncedStateSnapshotRef.current = params.applySyncedStateSnapshot;
  const shouldDeferSyncedStateSnapshotRef = useRef<(state: SequenceStateSnapshot) => boolean>(() => false);
  shouldDeferSyncedStateSnapshotRef.current = (state) => shouldDeferSameOrOlderSnapshotForPendingLocalMove({
    hasPendingLocalMove: params.hasPendingCurrentTurnAction('move_piece'),
    localSequence: params.lastAppliedSequenceRef.current,
    remoteSequence: Number(state.lastSequence ?? 0),
  });
  const latestSyncedStateRef = useRef<SequenceStateSnapshot | null>(null);

  const rememberAndApplySyncedStateSnapshot = useCallback((state: SequenceStateSnapshot, options?: SnapshotApplyOptions) => {
    const aliasedState = aliasTimeoutRollMutationIds(params.activeRoomIdRef.current, state);
    if (shouldDeferSyncedStateSnapshotRef.current(aliasedState)) return;
    latestSyncedStateRef.current = aliasedState;
    applySyncedStateSnapshotRef.current(aliasedState, options);
  }, [params.activeRoomIdRef]);

  const authoritativeApplyWakeTimerRef = useRef<number | null>(null);
  const clearAuthoritativeApplyWake = useCallback(() => {
    if (authoritativeApplyWakeTimerRef.current === null) return;
    window.clearTimeout(authoritativeApplyWakeTimerRef.current);
    authoritativeApplyWakeTimerRef.current = null;
  }, []);
  const scheduleAuthoritativeApplyWake = useCallback((roomId: string, appliedValue: unknown) => {
    const aliasedAppliedValue = aliasTimeoutRollMutationIds(roomId, appliedValue);
    const appliedSnapshot = buildAuthoritativeApplyWakeSnapshot(aliasedAppliedValue, latestSyncedStateRef.current);
    if (params.activeRoomIdRef.current !== roomId || !appliedSnapshot) return;
    const appliedSequence = Number(appliedSnapshot.lastSequence ?? 0);
    if (!appliedSequence) return;
    clearAuthoritativeApplyWake();
    authoritativeApplyWakeTimerRef.current = window.setTimeout(() => {
      authoritativeApplyWakeTimerRef.current = null;
      if (params.activeRoomIdRef.current !== roomId || appliedSequence < params.lastAppliedSequenceRef.current) return;
      const wakeSnapshot = buildAuthoritativeApplyWakeSnapshot(aliasedAppliedValue, latestSyncedStateRef.current);
      if (!wakeSnapshot) return;
      latestSyncedStateRef.current = wakeSnapshot;
      applySyncedStateSnapshotRef.current(wakeSnapshot, {
        allowMoveAnimation: false,
        allowRollAnimation: false,
        updateVersion: false,
        updateSequence: false,
      });
    }, 0);
  }, [clearAuthoritativeApplyWake, params.activeRoomIdRef, params.lastAppliedSequenceRef]);

  const queuesRef = useRef<ReturnType<typeof createAuthoritativeGameActionQueues<CommittableGameAction, AuthoritativeCommitResult>> | null>(null);
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
    const previousRoomId = previousRoomIdRef.current;
    previousRoomIdRef.current = params.activeRoomId;
    clearAuthoritativeApplyWake();
    latestSyncedStateRef.current = null;
    queuesRef.current?.reset();
    setManualSequenceSyncing(false);
    params.clearPendingLocalRemoteActions();
    clearTimeoutRollMutationAliases(previousRoomId);
  }, [clearAuthoritativeApplyWake, params.activeRoomId, params.clearPendingLocalRemoteActions]);

  useEffect(() => clearAuthoritativeApplyWake, [clearAuthoritativeApplyWake]);

  useGameSyncSubscription({
    activeRoomId: params.activeRoomId,
    lastAppliedSequenceRef: params.lastAppliedSequenceRef,
    lastAppliedStateVersionRef: params.lastAppliedStateVersionRef,
    applyingSyncedStateRef: params.applyingSyncedStateRef,
    replayMissingSequencesThenApply: (state, localSequence, remoteSequence) => withGameSequenceReplayCache(
      params.activeRoomId,
      localSequence,
      remoteSequence,
      getSequenceRefetchAfter(localSequence),
      () => params.replayMissingSequencesThenApply(
        aliasTimeoutRollMutationIds(params.activeRoomId, state),
        localSequence,
        remoteSequence,
      ),
    ),
    applySyncedStateSnapshot: rememberAndApplySyncedStateSnapshot,
    enqueueAuthoritativeResultApplication: (applyResult) => enqueueAuthoritativeResultApplication(params.activeRoomId, applyResult),
    onSnapshotReceived: (state) => {
      params.onSnapshotReceived?.(aliasTimeoutRollMutationIds(params.activeRoomId, state));
    },
  });

  const commitCanonicalAction = useCallback(async (roomId: string, action: CommittableGameAction) => {
    try {
      return await queuesRef.current!.commitQueuedAuthoritativeGameAction(roomId, action);
    } catch (firstError) {
      if (!isTimedOutRollAction(action)) throw firstError;
      return queuesRef.current!.commitQueuedAuthoritativeGameAction(roomId, action);
    }
  }, []);

  const commitQueuedAuthoritativeGameAction = useCallback((roomId: string, action: CommittableGameAction) => {
    const normalizedAction = canonicalizeTimeoutRollAction(roomId, attachClientActionStartedAt(action));
    return commitCanonicalAction(roomId, normalizedAction)
      .then((result) => aliasTimeoutRollMutationIds(roomId, result));
  }, [commitCanonicalAction]);

  const enqueueAuthoritativeResultApplication = useCallback(<T,>(roomId: string, applyResult: () => Promise<T> | T): Promise<T | null> => {
    return queuesRef.current!.enqueueAuthoritativeResultApplication(roomId, async () => {
      const result = await applyResult();
      return aliasTimeoutRollMutationIds(roomId, result);
    });
  }, []);

  const enqueueAuthoritativeGameAction = useCallback((
    roomId: string,
    action: CommittableGameAction,
    handleResult: (result: AuthoritativeCommitResult) => Promise<void> | void,
    handleError: (error: unknown) => void,
    handleFinally: () => void,
  ) => {
    const normalizedAction = canonicalizeTimeoutRollAction(roomId, attachClientActionStartedAt(action));
    void (async () => {
      try {
        const result = await commitCanonicalAction(roomId, normalizedAction);
        const aliasedResult = aliasTimeoutRollMutationIds(roomId, result);
        await queuesRef.current!.enqueueAuthoritativeResultApplication(roomId, async () => {
          await handleResult(aliasedResult);
          return aliasedResult;
        });
      } catch (error) {
        await queuesRef.current!.enqueueAuthoritativeResultApplication(roomId, () => {
          handleError(error);
        });
      } finally {
        handleFinally();
      }
    })();
  }, [commitCanonicalAction]);

  const applyAuthoritativeResultSequence = useCallback((result: AuthoritativeCommitResult) => (
    params.applyAuthoritativeResultSequence(
      aliasTimeoutRollMutationIds(params.activeRoomIdRef.current, result),
    )
  ), [params.activeRoomIdRef, params.applyAuthoritativeResultSequence]);

  const addPendingLocalRemoteAction = useCallback((actionKey: string, metadata?: PendingMeta) => {
    if (metadata?.type === 'roll_yut' && metadata.actorId) {
      registerPendingTimeoutRollCandidate(params.activeRoomIdRef.current, actionKey, metadata.actorId);
    }
    params.addPendingLocalRemoteAction(actionKey, metadata);
  }, [params.activeRoomIdRef, params.addPendingLocalRemoteAction]);

  const acknowledgePendingLocalRemoteAction = useCallback((clientMutationId: unknown) => {
    params.acknowledgePendingLocalRemoteAction(clientMutationId);
    if (typeof clientMutationId === 'string') {
      removePendingTimeoutRollCandidate(params.activeRoomIdRef.current, clientMutationId);
    }
  }, [params.activeRoomIdRef, params.acknowledgePendingLocalRemoteAction]);

  const removeSettledPendingLocalRemoteAction = useCallback((actionKey: string) => {
    params.removeSettledPendingLocalRemoteAction(actionKey);
    removePendingTimeoutRollCandidate(params.activeRoomIdRef.current, actionKey);
  }, [params.activeRoomIdRef, params.removeSettledPendingLocalRemoteAction]);

  return {
    commitQueuedAuthoritativeGameAction,
    enqueueAuthoritativeResultApplication,
    enqueueAuthoritativeGameAction,
    applyAuthoritativeResultSequence,
    syncLatestAuthoritativeState: params.syncLatestAuthoritativeState,
    syncLatestSequencesFromBadge: params.syncLatestSequencesFromBadge,
    reconcilePendingLocalRemoteActions: params.reconcilePendingLocalRemoteActions,
    addPendingLocalRemoteAction,
    acknowledgePendingLocalRemoteAction,
    removeSettledPendingLocalRemoteAction,
    clearPendingLocalRemoteActions: params.clearPendingLocalRemoteActions,
    hasPendingCurrentTurnAction: params.hasPendingCurrentTurnAction,
    pendingLocalRemoteActionCount: params.pendingLocalRemoteActionCount,
    manualSequenceSyncing,
    setManualSequenceSyncing,
  };
}
