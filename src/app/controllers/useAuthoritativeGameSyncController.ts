import { useCallback, useEffect, useRef, useState } from 'react';
import { commitAuthoritativeGameAction, withGameSequenceReplayCache, type GameAction } from '../../features/room/services/roomService';
import { getTurnRecoveryDeadlineAt } from '../../features/room/services/roomTiming';
import { attachClientActionStartedAt } from '../../features/room/services/turnActionStartedAtPolicy';
import {
  aliasTimeoutRollMutationIds,
  canonicalizeTimeoutRollAction,
  clearTimeoutRollMutationAliases,
  hasPendingTimeoutRollCandidate,
  registerPendingTimeoutRollCandidate,
  removePendingTimeoutRollCandidate,
} from '../../features/room/services/timeoutRollActionIdentity';
import type { SequenceStateSnapshot } from '../appState';
import { getQaMovePieceActionDelayMs, shouldFailQaTimeoutRollCommit } from '../config/qaDelays';
import { buildAuthoritativeApplyWakeSnapshot, shouldApplyAuthoritativeWake } from '../flows/authoritativeApplyWakeFlow';
import { createAuthoritativeGameActionQueues } from '../flows/authoritativeGameSyncFlow';
import {
  localMovePresentationLifecycle,
  shouldDeferAuthoritativeStateForLocalMove,
} from '../flows/localMovePresentationLifecycle';
import { shouldResyncRejectedPendingMove } from '../flows/optimisticMoveRejectionPolicy';
import { useGameSyncSubscription } from '../hooks/useGameSync';
import { shouldDeferSameOrOlderSnapshotForPendingLocalMove } from '../hooks/localOptimisticSnapshotPolicy';
import { getSequenceRefetchAfter } from '../utils/sequenceRefetch';

export type AuthoritativeCommitResult = Awaited<ReturnType<typeof commitAuthoritativeGameAction>>;

type RemoteActionType = GameAction['type'];
type PendingMeta = { type?: RemoteActionType; actorId?: string; createdSequence?: number; createdTurnIndex?: number; optimisticApplied?: boolean };
type SnapshotApplyOptions = { allowMoveAnimation?: boolean; allowRollAnimation?: boolean; updateVersion?: boolean; updateSequence?: boolean };
type SyncLatestOptions = { allowRollAnimation?: boolean; diagnosticType?: 'roll_yut' | 'move_piece' };
type CommittableGameAction = Omit<GameAction, 'id' | 'createdAt' | 'processed'>;
type DeferredSyncedState = {
  roomId: string;
  state: SequenceStateSnapshot;
  options?: SnapshotApplyOptions;
};

type Params = {
  activeRoomId: string;
  activeRoomIdRef: React.MutableRefObject<string>;
  lastAppliedSequenceRef: React.MutableRefObject<number>;
  lastAppliedStateVersionRef: React.MutableRefObject<number>;
  applyingSyncedStateRef: React.MutableRefObject<boolean>;
  replayMissingSequencesThenApply: (finalState: SequenceStateSnapshot, localSequence: number, remoteSequence: number) => Promise<void>;
  applySyncedStateSnapshot: (state: SequenceStateSnapshot, options?: SnapshotApplyOptions) => void;
  applyAuthoritativeResultSequence: (result: AuthoritativeCommitResult) => Promise<unknown>;
  syncLatestAuthoritativeState: (reason: string, options?: SyncLatestOptions) => Promise<boolean>;
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

const getClientActionId = (action: CommittableGameAction) => {
  if (!action.payload || typeof action.payload !== 'object') return '';
  const clientActionId = (action.payload as Record<string, unknown>).clientActionId;
  return typeof clientActionId === 'string' ? clientActionId : '';
};

const getMovePieceId = (action: CommittableGameAction) => {
  if (action.type !== 'move_piece' || !action.payload || typeof action.payload !== 'object') return '';
  const pieceId = (action.payload as Record<string, unknown>).pieceId;
  return typeof pieceId === 'string' ? pieceId : '';
};

const getResolvedTimeoutDeadlineAt = (action: CommittableGameAction) => {
  if (!action.payload || typeof action.payload !== 'object') return 0;
  const payload = action.payload as Record<string, unknown>;
  const deadlineAt = Number(payload.resolvedTimeoutDeadlineAt ?? payload.timeoutDeadlineAt ?? 0);
  return Number.isFinite(deadlineAt) && deadlineAt > 0 ? Math.trunc(deadlineAt) : 0;
};

const getAuthoritativeResultRecord = (result: AuthoritativeCommitResult) => (
  result as unknown as Record<string, unknown>
);

const getAuthoritativeResultSequence = (result: AuthoritativeCommitResult) => {
  const record = getAuthoritativeResultRecord(result);
  const stateAfter = record.stateAfter && typeof record.stateAfter === 'object'
    ? record.stateAfter as Record<string, unknown>
    : null;
  const patch = record.patch && typeof record.patch === 'object'
    ? record.patch as Record<string, unknown>
    : null;
  const sequence = Number(record.sequence ?? stateAfter?.lastSequence ?? patch?.lastSequence ?? 0);
  return Number.isFinite(sequence) && sequence > 0 ? Math.trunc(sequence) : 0;
};

const getAuthoritativeResultClientMutationId = (result: AuthoritativeCommitResult) => {
  const record = getAuthoritativeResultRecord(result);
  const sequenceEvent = record.sequenceEvent && typeof record.sequenceEvent === 'object'
    ? record.sequenceEvent as Record<string, unknown>
    : null;
  const stateAfter = record.stateAfter && typeof record.stateAfter === 'object'
    ? record.stateAfter as Record<string, unknown>
    : null;
  const patch = record.patch && typeof record.patch === 'object'
    ? record.patch as Record<string, unknown>
    : null;
  const payload = record.payload && typeof record.payload === 'object'
    ? record.payload as Record<string, unknown>
    : null;
  const clientMutationId = sequenceEvent?.clientMutationId
    ?? stateAfter?.lastClientMutationId
    ?? patch?.lastClientMutationId
    ?? payload?.clientMutationId;
  return typeof clientMutationId === 'string' ? clientMutationId : '';
};

const waitUntil = (timestamp: number) => new Promise<void>((resolve) => {
  window.setTimeout(resolve, Math.max(0, timestamp - Date.now()));
});

const markTimeoutRollAsRecovery = (action: CommittableGameAction): CommittableGameAction => {
  const timeoutDeadlineAt = getResolvedTimeoutDeadlineAt(action);
  if (!timeoutDeadlineAt || !action.payload || typeof action.payload !== 'object') return action;
  const payload = action.payload as Record<string, unknown>;
  return {
    ...action,
    payload: {
      ...payload,
      timeoutDeadlineAt,
      timeoutRecoveredBy: typeof payload.timeoutRecoveredBy === 'string' && payload.timeoutRecoveredBy
        ? payload.timeoutRecoveredBy
        : 'client-timeout-fallback',
      timeoutSource: payload.timeoutSource ?? 'client-retry-fallback',
    },
  };
};

export function useAuthoritativeGameSyncController(params: Params) {
  const applySyncedStateSnapshotRef = useRef(params.applySyncedStateSnapshot);
  applySyncedStateSnapshotRef.current = params.applySyncedStateSnapshot;
  const latestSyncedStateRef = useRef<SequenceStateSnapshot | null>(null);
  const deferredSyncedStateRef = useRef<DeferredSyncedState | null>(null);
  const deferredApplyRequestRef = useRef(0);
  const claimedMoveSequenceRef = useRef(0);
  const serializedLocalMoveActionKeysRef = useRef<Set<string>>(new Set());

  const hasPendingLocalMovePresentation = useCallback(() => shouldDeferAuthoritativeStateForLocalMove({
    hasPendingLocalMove: params.hasPendingCurrentTurnAction('move_piece'),
    presentationActive: localMovePresentationLifecycle.isActive(),
  }), [params.hasPendingCurrentTurnAction]);

  const waitForPendingLocalMovePresentation = useCallback(async () => {
    while (hasPendingLocalMovePresentation()) {
      await localMovePresentationLifecycle.waitForSettlement();
    }
  }, [hasPendingLocalMovePresentation]);

  const shouldDeferSyncedStateSnapshotRef = useRef<(state: SequenceStateSnapshot) => boolean>(() => false);
  shouldDeferSyncedStateSnapshotRef.current = (state) => shouldDeferSameOrOlderSnapshotForPendingLocalMove({
    hasPendingLocalMove: params.hasPendingCurrentTurnAction('move_piece'),
    localSequence: params.lastAppliedSequenceRef.current,
    remoteSequence: Number(state.lastSequence ?? 0),
  });

  const claimMoveSequence = useCallback((sequence: number) => {
    if (!sequence) return true;
    const appliedSequence = Math.max(params.lastAppliedSequenceRef.current, claimedMoveSequenceRef.current);
    if (sequence <= appliedSequence) return false;
    claimedMoveSequenceRef.current = sequence;
    return true;
  }, [params.lastAppliedSequenceRef]);

  const clearSettledDeferredState = useCallback(() => {
    const deferredState = deferredSyncedStateRef.current;
    if (!deferredState) return;
    const deferredSequence = Number(deferredState.state.lastSequence ?? 0);
    const appliedSequence = Math.max(params.lastAppliedSequenceRef.current, claimedMoveSequenceRef.current);
    if (deferredSequence && deferredSequence <= appliedSequence) {
      deferredSyncedStateRef.current = null;
      deferredApplyRequestRef.current += 1;
    }
  }, [params.lastAppliedSequenceRef]);

  const scheduleDeferredSyncedStateApply = useCallback((deferredState: DeferredSyncedState) => {
    deferredSyncedStateRef.current = deferredState;
    const requestId = deferredApplyRequestRef.current + 1;
    deferredApplyRequestRef.current = requestId;
    void (async () => {
      await waitForPendingLocalMovePresentation();
      if (deferredApplyRequestRef.current !== requestId) return;
      const latestDeferredState = deferredSyncedStateRef.current;
      if (!latestDeferredState || latestDeferredState.roomId !== params.activeRoomIdRef.current) {
        deferredSyncedStateRef.current = null;
        return;
      }
      const remoteSequence = Number(latestDeferredState.state.lastSequence ?? 0);
      const appliedSequence = Math.max(params.lastAppliedSequenceRef.current, claimedMoveSequenceRef.current);
      if (remoteSequence && remoteSequence <= appliedSequence) {
        deferredSyncedStateRef.current = null;
        return;
      }
      if (!claimMoveSequence(remoteSequence)) {
        deferredSyncedStateRef.current = null;
        return;
      }
      deferredSyncedStateRef.current = null;
      applySyncedStateSnapshotRef.current(latestDeferredState.state, latestDeferredState.options);
    })();
  }, [claimMoveSequence, params.activeRoomIdRef, params.lastAppliedSequenceRef, waitForPendingLocalMovePresentation]);

  const rememberAndApplySyncedStateSnapshot = useCallback((state: SequenceStateSnapshot, options?: SnapshotApplyOptions) => {
    const roomId = params.activeRoomIdRef.current;
    const aliasedState = aliasTimeoutRollMutationIds(roomId, state);
    if (shouldDeferSyncedStateSnapshotRef.current(aliasedState)) return;
    latestSyncedStateRef.current = aliasedState;
    if (hasPendingLocalMovePresentation()) {
      scheduleDeferredSyncedStateApply({ roomId, state: aliasedState, options });
      return;
    }
    applySyncedStateSnapshotRef.current(aliasedState, options);
  }, [hasPendingLocalMovePresentation, params.activeRoomIdRef, scheduleDeferredSyncedStateApply]);

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
      const wakeSnapshot = buildAuthoritativeApplyWakeSnapshot(aliasedAppliedValue, latestSyncedStateRef.current);
      if (!wakeSnapshot) return;
      const wakeSequence = Number(wakeSnapshot.lastSequence ?? appliedSequence);
      const deferred = shouldDeferSyncedStateSnapshotRef.current(wakeSnapshot);
      if (hasPendingLocalMovePresentation()) {
        latestSyncedStateRef.current = wakeSnapshot;
        scheduleDeferredSyncedStateApply({
          roomId,
          state: wakeSnapshot,
          options: {
            allowMoveAnimation: false,
            allowRollAnimation: false,
            updateVersion: false,
            updateSequence: false,
          },
        });
        return;
      }
      if (!shouldApplyAuthoritativeWake({
        roomMatches: params.activeRoomIdRef.current === roomId,
        appliedSequence: wakeSequence,
        lastAppliedSequence: params.lastAppliedSequenceRef.current,
        deferred,
      })) return;
      latestSyncedStateRef.current = wakeSnapshot;
      applySyncedStateSnapshotRef.current(wakeSnapshot, {
        allowMoveAnimation: false,
        allowRollAnimation: false,
        updateVersion: false,
        updateSequence: false,
      });
    }, 0);
  }, [clearAuthoritativeApplyWake, hasPendingLocalMovePresentation, params.activeRoomIdRef, params.lastAppliedSequenceRef, scheduleDeferredSyncedStateApply]);

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
    localMovePresentationLifecycle.cancel();
    latestSyncedStateRef.current = null;
    deferredSyncedStateRef.current = null;
    deferredApplyRequestRef.current += 1;
    claimedMoveSequenceRef.current = params.lastAppliedSequenceRef.current;
    serializedLocalMoveActionKeysRef.current.clear();
    queuesRef.current?.reset();
    setManualSequenceSyncing(false);
    params.clearPendingLocalRemoteActions();
    clearTimeoutRollMutationAliases(previousRoomId);
  }, [clearAuthoritativeApplyWake, params.activeRoomId, params.clearPendingLocalRemoteActions, params.lastAppliedSequenceRef]);

  useEffect(() => clearAuthoritativeApplyWake, [clearAuthoritativeApplyWake]);

  useGameSyncSubscription({
    activeRoomId: params.activeRoomId,
    lastAppliedSequenceRef: params.lastAppliedSequenceRef,
    lastAppliedStateVersionRef: params.lastAppliedStateVersionRef,
    applyingSyncedStateRef: params.applyingSyncedStateRef,
    replayMissingSequencesThenApply: async (state, localSequence, remoteSequence) => {
      await waitForPendingLocalMovePresentation();
      return withGameSequenceReplayCache(
        params.activeRoomId,
        localSequence,
        remoteSequence,
        getSequenceRefetchAfter(localSequence),
        () => params.replayMissingSequencesThenApply(
          aliasTimeoutRollMutationIds(params.activeRoomId, state),
          localSequence,
          remoteSequence,
        ),
      );
    },
    applySyncedStateSnapshot: rememberAndApplySyncedStateSnapshot,
    enqueueAuthoritativeResultApplication: (applyResult) => enqueueAuthoritativeResultApplication(params.activeRoomId, applyResult),
    onSnapshotReceived: (state) => {
      params.onSnapshotReceived?.(aliasTimeoutRollMutationIds(params.activeRoomId, state));
    },
  });

  const commitCanonicalAction = useCallback(async (roomId: string, action: CommittableGameAction) => {
    const clientActionId = getClientActionId(action);
    const timeoutDeadlineAt = getResolvedTimeoutDeadlineAt(action);
    const recoveryAt = timeoutDeadlineAt ? getTurnRecoveryDeadlineAt(timeoutDeadlineAt) : 0;
    const commitOnce = (candidateAction: CommittableGameAction) => {
      if (shouldFailQaTimeoutRollCommit(clientActionId)) {
        return Promise.reject(new Error('QA timeout roll commit failure'));
      }
      return queuesRef.current!.commitQueuedAuthoritativeGameAction(roomId, candidateAction);
    };
    const initialAction = recoveryAt && Date.now() >= recoveryAt ? markTimeoutRollAsRecovery(action) : action;
    try {
      return await commitOnce(initialAction);
    } catch {
      try {
        return await commitOnce(initialAction);
      } catch {
        if (recoveryAt) await waitUntil(recoveryAt);
        return commitOnce(markTimeoutRollAsRecovery(action));
      }
    }
  }, []);

  const commitQueuedAuthoritativeGameAction = useCallback((roomId: string, action: CommittableGameAction) => {
    const attachedAction = attachClientActionStartedAt(action);
    if (!isTimedOutRollAction(attachedAction)) {
      return queuesRef.current!.commitQueuedAuthoritativeGameAction(roomId, attachedAction);
    }
    const normalizedAction = canonicalizeTimeoutRollAction(roomId, attachedAction);
    return commitCanonicalAction(roomId, normalizedAction)
      .then((result) => aliasTimeoutRollMutationIds(roomId, result));
  }, [commitCanonicalAction]);

  const enqueueAuthoritativeResultApplication = useCallback(<T,>(roomId: string, applyResult: () => Promise<T> | T): Promise<T | null> => {
    return queuesRef.current!.enqueueAuthoritativeResultApplication(roomId, async () => {
      const result = await applyResult();
      return aliasTimeoutRollMutationIds(roomId, result);
    });
  }, []);

  const syncLatestAuthoritativeState = useCallback(async (reason: string, options?: SyncLatestOptions) => {
    await waitForPendingLocalMovePresentation();
    return params.syncLatestAuthoritativeState(reason, options);
  }, [params.syncLatestAuthoritativeState, waitForPendingLocalMovePresentation]);

  const syncLatestSequencesFromBadge = useCallback(async () => {
    await waitForPendingLocalMovePresentation();
    return params.syncLatestSequencesFromBadge();
  }, [params.syncLatestSequencesFromBadge, waitForPendingLocalMovePresentation]);

  const enqueueAuthoritativeGameAction = useCallback((
    roomId: string,
    action: CommittableGameAction,
    handleResult: (result: AuthoritativeCommitResult) => Promise<void> | void,
    handleError: (error: unknown) => void,
    handleFinally: () => void,
  ) => {
    const attachedAction = attachClientActionStartedAt(action);
    const movePieceId = getMovePieceId(attachedAction);
    const clientActionId = getClientActionId(attachedAction);
    if (movePieceId && clientActionId && params.hasPendingCurrentTurnAction('move_piece', attachedAction.actorId)) {
      serializedLocalMoveActionKeysRef.current.add(clientActionId);
      localMovePresentationLifecycle.begin(clientActionId);
    }
    if (!isTimedOutRollAction(attachedAction)) {
      queuesRef.current!.enqueueAuthoritativeGameAction(roomId, attachedAction, {
        handleResult: async (result) => {
          const moveResultDelayMs = attachedAction.type === 'move_piece' ? getQaMovePieceActionDelayMs() : 0;
          if (moveResultDelayMs) await waitUntil(Date.now() + moveResultDelayMs);
          if (shouldResyncRejectedPendingMove({
            actionType: attachedAction.type,
            status: result.status,
            hasPendingMove: params.hasPendingCurrentTurnAction('move_piece', attachedAction.actorId),
          })) {
            await syncLatestAuthoritativeState(
              result.reason ?? '서버가 말 이동 요청을 거부해 최신 authoritative 상태로 재동기화합니다.',
              { diagnosticType: 'move_piece' },
            );
          }
          await handleResult(result);
        },
        handleError,
        handleFinally,
      });
      return;
    }

    const normalizedAction = canonicalizeTimeoutRollAction(roomId, attachedAction);
    void (async () => {
      try {
        const result = await commitCanonicalAction(roomId, normalizedAction);
        const aliasedResult = aliasTimeoutRollMutationIds(roomId, result);
        await queuesRef.current!.enqueueAuthoritativeResultApplication(roomId, async () => {
          await handleResult(aliasedResult);
          return aliasedResult;
        });
      } catch (error) {
        console.warn('시간초과 윷 제출과 동일 payload fallback이 모두 실패했습니다.', {
          roomId,
          clientActionId: getClientActionId(normalizedAction),
        });
        handleError(error);
      } finally {
        handleFinally();
      }
    })();
  }, [commitCanonicalAction, params.hasPendingCurrentTurnAction, syncLatestAuthoritativeState]);

  const applyAuthoritativeResultSequence = useCallback(async (result: AuthoritativeCommitResult) => {
    const roomId = params.activeRoomIdRef.current;
    const aliasedResult = aliasTimeoutRollMutationIds(roomId, result);
    const activeActionKey = localMovePresentationLifecycle.snapshot().actionKey;
    const resultActionKey = getAuthoritativeResultClientMutationId(aliasedResult);
    const serializedActionKey = resultActionKey && serializedLocalMoveActionKeysRef.current.has(resultActionKey)
      ? resultActionKey
      : activeActionKey && serializedLocalMoveActionKeysRef.current.has(activeActionKey)
        ? activeActionKey
        : '';
    if (serializedActionKey) await waitForPendingLocalMovePresentation();
    const sequence = getAuthoritativeResultSequence(aliasedResult);
    if (serializedActionKey && !claimMoveSequence(sequence)) {
      clearSettledDeferredState();
      return null;
    }
    try {
      const appliedState = await params.applyAuthoritativeResultSequence(aliasedResult);
      clearSettledDeferredState();
      return appliedState;
    } catch (error) {
      if (serializedActionKey && sequence && claimedMoveSequenceRef.current === sequence) {
        claimedMoveSequenceRef.current = params.lastAppliedSequenceRef.current;
      }
      throw error;
    }
  }, [claimMoveSequence, clearSettledDeferredState, params.activeRoomIdRef, params.applyAuthoritativeResultSequence, params.lastAppliedSequenceRef, waitForPendingLocalMovePresentation]);

  const addPendingLocalRemoteAction = useCallback((actionKey: string, metadata?: PendingMeta) => {
    if (metadata?.type === 'roll_yut' && metadata.actorId) {
      registerPendingTimeoutRollCandidate(params.activeRoomIdRef.current, actionKey, metadata.actorId);
    }
    params.addPendingLocalRemoteAction(actionKey, metadata);
  }, [params.activeRoomIdRef, params.addPendingLocalRemoteAction]);

  const acknowledgePendingLocalRemoteAction = useCallback((clientMutationId: unknown) => {
    params.acknowledgePendingLocalRemoteAction(clientMutationId);
    if (typeof clientMutationId === 'string') {
      serializedLocalMoveActionKeysRef.current.delete(clientMutationId);
      removePendingTimeoutRollCandidate(params.activeRoomIdRef.current, clientMutationId);
    }
  }, [params.activeRoomIdRef, params.acknowledgePendingLocalRemoteAction]);

  const removeSettledPendingLocalRemoteAction = useCallback((actionKey: string) => {
    serializedLocalMoveActionKeysRef.current.delete(actionKey);
    params.removeSettledPendingLocalRemoteAction(actionKey);
    removePendingTimeoutRollCandidate(params.activeRoomIdRef.current, actionKey);
  }, [params.activeRoomIdRef, params.removeSettledPendingLocalRemoteAction]);

  const clearPendingLocalRemoteActions = useCallback(() => {
    localMovePresentationLifecycle.cancel();
    serializedLocalMoveActionKeysRef.current.clear();
    deferredSyncedStateRef.current = null;
    deferredApplyRequestRef.current += 1;
    params.clearPendingLocalRemoteActions();
  }, [params.clearPendingLocalRemoteActions]);

  const hasPendingCurrentTurnAction = useCallback((type: RemoteActionType, actorId?: string) => {
    if (type === 'roll_yut'
      && actorId
      && hasPendingTimeoutRollCandidate(params.activeRoomIdRef.current, actorId)) {
      return false;
    }
    return params.hasPendingCurrentTurnAction(type, actorId);
  }, [params.activeRoomIdRef, params.hasPendingCurrentTurnAction]);

  return {
    commitQueuedAuthoritativeGameAction,
    enqueueAuthoritativeResultApplication,
    enqueueAuthoritativeGameAction,
    applyAuthoritativeResultSequence,
    syncLatestAuthoritativeState,
    syncLatestSequencesFromBadge,
    reconcilePendingLocalRemoteActions: params.reconcilePendingLocalRemoteActions,
    addPendingLocalRemoteAction,
    acknowledgePendingLocalRemoteAction,
    removeSettledPendingLocalRemoteAction,
    clearPendingLocalRemoteActions,
    hasPendingCurrentTurnAction,
    pendingLocalRemoteActionCount: params.pendingLocalRemoteActionCount,
    manualSequenceSyncing,
    setManualSequenceSyncing,
  };
}
