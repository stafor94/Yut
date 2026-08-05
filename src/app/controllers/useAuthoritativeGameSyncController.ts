import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import { commitAuthoritativeGameAction, getGameSequencesSince, getLatestGameState, withGameSequenceReplayCache, type GameAction } from '../../features/room/services/roomService';
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
import { getAuthoritativeSnapshot } from '../flows/authoritativeSnapshot';
import { createAuthoritativeGameActionQueues } from '../flows/authoritativeGameSyncFlow';
import {
  classifyLocalMoveCommitAck,
  makeStatelessDuplicateRecoveryKey,
  shouldReleaseLocalMovePending,
} from '../flows/localMoveCommitAck';
import { localMovePresentationLifecycle } from '../flows/localMovePresentationLifecycle';
import {
  classifyAuthoritativeDelivery,
  getAuthoritativeDeliveryIdentity,
  localMoveLedger,
  makeLocalMoveResultFingerprint,
  prepareLocalMoveOwnership,
  withLocalMovePiecesFallback,
} from '../flows/localMoveOwnership';
import { releaseMoveActionClaim, settleMoveActionClaim } from '../flows/moveExecutionPolicy';
import {
  clearPendingLocalMoveOwnershipPreparer,
  publishPendingLocalMoveOwnershipPreparer,
} from '../flows/pendingLocalMoveOwnership';
import { useGameSyncSubscription } from '../hooks/useGameSync';
import { getSequenceRefetchAfter } from '../utils/sequenceRefetch';

export type AuthoritativeCommitResult = Awaited<ReturnType<typeof commitAuthoritativeGameAction>>;

type RemoteActionType = GameAction['type'];
type PendingMeta = { type?: RemoteActionType; actorId?: string; createdSequence?: number; createdTurnIndex?: number; optimisticApplied?: boolean };
type SnapshotApplyOptions = { allowMoveAnimation?: boolean; allowRollAnimation?: boolean; updateVersion?: boolean; updateSequence?: boolean };
type SyncLatestOptions = { allowRollAnimation?: boolean; diagnosticType?: 'roll_yut' | 'move_piece' };
type CommittableGameAction = Omit<GameAction, 'id' | 'createdAt' | 'processed'>;

type Params = {
  activeRoomId: string;
  activeRoomIdRef: MutableRefObject<string>;
  lastAppliedSequenceRef: MutableRefObject<number>;
  lastAppliedStateVersionRef: MutableRefObject<number>;
  applyingSyncedStateRef: MutableRefObject<boolean>;
  currentPiecesRef: MutableRefObject<unknown[]>;
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

const getResolvedTimeoutDeadlineAt = (action: CommittableGameAction) => {
  if (!action.payload || typeof action.payload !== 'object') return 0;
  const payload = action.payload as Record<string, unknown>;
  const deadlineAt = Number(payload.resolvedTimeoutDeadlineAt ?? payload.timeoutDeadlineAt ?? 0);
  return Number.isFinite(deadlineAt) && deadlineAt > 0 ? Math.trunc(deadlineAt) : 0;
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

const getLocalDisplayFinalState = (state: SequenceStateSnapshot): SequenceStateSnapshot => ({
  ...state,
  captureEffect: null,
  trapEffect: null,
});

export function useAuthoritativeGameSyncController(params: Params) {
  const applySyncedStateSnapshotRef = useRef(params.applySyncedStateSnapshot);
  applySyncedStateSnapshotRef.current = params.applySyncedStateSnapshot;
  const latestSyncedStateRef = useRef<SequenceStateSnapshot | null>(null);
  const hardResyncPromisesRef = useRef<Map<string, Promise<boolean>>>(new Map());
  const statelessDuplicateRecoveryPromisesRef = useRef<Map<string, Promise<SequenceStateSnapshot | null>>>(new Map());
  const authoritativeLifecycleKeyRef = useRef('');

  const rememberAuthoritativeLifecycle = useCallback((state: SequenceStateSnapshot) => {
    const startRequestVersion = Number(state.startRequestVersion ?? 0);
    const startRequestId = String(state.startRequestId ?? '');
    if (!startRequestVersion || !startRequestId) return;
    const lifecycleKey = `${startRequestVersion}:${startRequestId}`;
    if (authoritativeLifecycleKeyRef.current && authoritativeLifecycleKeyRef.current !== lifecycleKey) {
      statelessDuplicateRecoveryPromisesRef.current.clear();
    }
    authoritativeLifecycleKeyRef.current = lifecycleKey;
  }, []);

  const runLocalMoveHardResync = useCallback((roomId: string, actionKey: string, reason: string) => {
    const existing = hardResyncPromisesRef.current.get(actionKey);
    if (existing) return existing;
    const record = localMoveLedger.get(actionKey);
    if (!record || record.roomId !== roomId || !localMoveLedger.claimHardResync(actionKey)) {
      return Promise.resolve(false);
    }

    params.applyingSyncedStateRef.current = true;
    console.error('온라인 로컬 말 이동 결과를 hard resync합니다.', {
      roomId,
      actionKey,
      reason,
    });
    const promise = (async () => {
      try {
        await localMovePresentationLifecycle.waitForSettlement();
        if (params.activeRoomIdRef.current !== roomId) return false;
        releaseMoveActionClaim(actionKey);
        localMoveLedger.remove(actionKey);
        params.removeSettledPendingLocalRemoteAction(actionKey);
        return await params.syncLatestAuthoritativeState(reason, {
          allowRollAnimation: false,
          diagnosticType: 'move_piece',
        });
      } finally {
        params.applyingSyncedStateRef.current = false;
        hardResyncPromisesRef.current.delete(actionKey);
      }
    })();
    hardResyncPromisesRef.current.set(actionKey, promise);
    return promise;
  }, [params.activeRoomIdRef, params.applyingSyncedStateRef, params.removeSettledPendingLocalRemoteAction, params.syncLatestAuthoritativeState]);

  const getDeliveryClassification = useCallback((value: unknown) => classifyAuthoritativeDelivery(
    getAuthoritativeDeliveryIdentity(value),
    {
      lastAppliedSequence: params.lastAppliedSequenceRef.current,
      lastAppliedStateVersion: params.lastAppliedStateVersionRef.current,
    },
  ), [params.lastAppliedSequenceRef, params.lastAppliedStateVersionRef]);

  const acknowledgeLocalMoveEcho = useCallback((roomId: string, value: unknown, explicitState?: SequenceStateSnapshot | null) => {
    const identity = getAuthoritativeDeliveryIdentity(value);
    if (!identity.clientMutationId || !localMoveLedger.has(identity.clientMutationId)) return null;
    const authoritativeState = explicitState ?? getAuthoritativeSnapshot<SequenceStateSnapshot>(value, null);
    if (!authoritativeState) return null;

    rememberAuthoritativeLifecycle(authoritativeState);
    latestSyncedStateRef.current = authoritativeState;
    params.lastAppliedSequenceRef.current = Math.max(params.lastAppliedSequenceRef.current, identity.sequence);
    params.lastAppliedStateVersionRef.current = Math.max(params.lastAppliedStateVersionRef.current, identity.stateVersion);

    const observed = localMoveLedger.observeAuthoritativeResult({
      clientMutationId: identity.clientMutationId,
      sequence: identity.sequence,
      stateVersion: identity.stateVersion,
      resultFingerprint: makeLocalMoveResultFingerprint(authoritativeState as Record<string, unknown>),
    });
    if (observed.status === 'mismatch') {
      void runLocalMoveHardResync(
        roomId,
        identity.clientMutationId,
        `서버 move_piece 결과가 로컬 결과와 일치하지 않습니다. actionKey=${identity.clientMutationId}`,
      );
      return authoritativeState;
    }
    if (observed.status === 'matched'
      && observed.record
      && shouldReleaseLocalMovePending(observed.record)) {
      settleMoveActionClaim(identity.clientMutationId);
      params.acknowledgePendingLocalRemoteAction(identity.clientMutationId);
    }
    return authoritativeState;
  }, [params.acknowledgePendingLocalRemoteAction, params.lastAppliedSequenceRef, params.lastAppliedStateVersionRef, rememberAuthoritativeLifecycle, runLocalMoveHardResync]);

  const recoverStatelessDuplicateLocalMove = useCallback((
    roomId: string,
    actionKey: string,
    result: AuthoritativeCommitResult,
  ) => {
    const recoveryKey = makeStatelessDuplicateRecoveryKey({ roomId, actionKey, sequence: result.sequence });
    if (!recoveryKey) return Promise.resolve(null);
    const existing = statelessDuplicateRecoveryPromisesRef.current.get(recoveryKey);
    if (existing) return existing;

    const cursorBefore = params.lastAppliedSequenceRef.current;
    const stateVersionBefore = params.lastAppliedStateVersionRef.current;
    const traceTarget = globalThis as typeof globalThis & {
      __YUT_STATELESS_DUPLICATE_ACK_TRACE__?: Array<Record<string, unknown>>;
    };
    const trace = Array.isArray(traceTarget.__YUT_STATELESS_DUPLICATE_ACK_TRACE__)
      ? traceTarget.__YUT_STATELESS_DUPLICATE_ACK_TRACE__
      : [];
    trace.push({
      roomId,
      actionKey,
      sequence: Number(result.sequence ?? 0),
      hasStateAfter: Boolean(result.stateAfter && typeof result.stateAfter === 'object'),
      hasPatch: Boolean(result.patch && typeof result.patch === 'object'),
      cursorBefore,
      cursorAfterAck: params.lastAppliedSequenceRef.current,
      stateVersionBefore,
      stateVersionAfterAck: params.lastAppliedStateVersionRef.current,
    });
    traceTarget.__YUT_STATELESS_DUPLICATE_ACK_TRACE__ = trace.slice(-8);

    const aliasedResult = aliasTimeoutRollMutationIds(roomId, {
      ...result,
      payload: {
        ...(result.payload ?? {}),
        clientMutationId: actionKey,
      },
    });
    const recovery = (async () => {
      const targetSequence = Number(result.sequence ?? 0);
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const localSequence = params.lastAppliedSequenceRef.current;
        const sequences = await getGameSequencesSince(
          roomId,
          getSequenceRefetchAfter(Math.min(localSequence, targetSequence - 1)),
        );
        if (params.activeRoomIdRef.current !== roomId) return null;
        const targetEvent = sequences.find((sequence) => Number(sequence.sequence ?? 0) === targetSequence);
        if (targetEvent?.patch) {
          const baseState = latestSyncedStateRef.current ?? await getLatestGameState(roomId) as SequenceStateSnapshot | null;
          const patchedState = getAuthoritativeSnapshot<SequenceStateSnapshot>({ patch: targetEvent.patch }, baseState);
          if (patchedState) {
            const authoritativeState = aliasTimeoutRollMutationIds(roomId, {
              ...patchedState,
              lastSequence: targetSequence,
              turnVersion: Number(result.turnVersion ?? patchedState.turnVersion ?? 0),
              lastClientMutationId: actionKey,
            });
            return acknowledgeLocalMoveEcho(roomId, {
              ...aliasedResult,
              stateAfter: authoritativeState,
            }, authoritativeState);
          }
        }
        if (attempt < 3) await waitUntil(Date.now() + 50 * (attempt + 1));
      }
      return null;
    })().catch((error) => {
      console.warn('상태 없는 duplicate move_piece ACK의 sequence-first 복구에 실패했습니다.', {
        roomId,
        actionKey,
        sequence: result.sequence,
        error,
      });
      return null;
    });
    statelessDuplicateRecoveryPromisesRef.current.set(recoveryKey, recovery);
    return recovery;
  }, [acknowledgeLocalMoveEcho, params.activeRoomIdRef, params.lastAppliedSequenceRef, params.lastAppliedStateVersionRef]);

  const prepareAndFinalizeLocalMove = useCallback((roomId: string, action: CommittableGameAction) => {
    if (action.type !== 'move_piece') return false;
    const actionId = getClientActionId(action);
    if (actionId && localMoveLedger.has(actionId)) return true;
    const prepared = prepareLocalMoveOwnership({
      roomId,
      state: withLocalMovePiecesFallback(
        latestSyncedStateRef.current as Record<string, unknown> | null,
        params.currentPiecesRef.current,
      ),
      action,
    });
    if (!prepared) return false;

    const actionKey = prepared.record.clientMutationId;
    if (localMoveLedger.has(actionKey)) return true;
    localMoveLedger.register(prepared.record);
    const presentationSettlement = localMovePresentationLifecycle.waitForSettlement();
    void presentationSettlement.then(() => {
      const record = localMoveLedger.get(actionKey);
      if (!record || record.roomId !== roomId || record.hardResyncStarted) return;
      if (params.activeRoomIdRef.current !== roomId) {
        releaseMoveActionClaim(actionKey);
        localMoveLedger.remove(actionKey);
        return;
      }
      const finalState = prepared.finalState as SequenceStateSnapshot;
      latestSyncedStateRef.current = finalState;
      applySyncedStateSnapshotRef.current(getLocalDisplayFinalState(finalState), {
        allowMoveAnimation: false,
        allowRollAnimation: false,
        updateVersion: false,
        updateSequence: false,
      });
      localMoveLedger.markPresentationCompleted(actionKey);
      if (shouldReleaseLocalMovePending(record)) {
        settleMoveActionClaim(actionKey);
        params.acknowledgePendingLocalRemoteAction(actionKey);
      }
    });
    return true;
  }, [params.acknowledgePendingLocalRemoteAction, params.activeRoomIdRef, params.currentPiecesRef]);

  const preparePendingLocalMoveOwnership = useCallback((action: CommittableGameAction) => {
    const roomId = params.activeRoomIdRef.current;
    if (!roomId) return false;
    return prepareAndFinalizeLocalMove(roomId, action);
  }, [params.activeRoomIdRef, prepareAndFinalizeLocalMove]);
  publishPendingLocalMoveOwnershipPreparer(preparePendingLocalMoveOwnership);
  useEffect(() => () => {
    clearPendingLocalMoveOwnershipPreparer(preparePendingLocalMoveOwnership);
  }, [preparePendingLocalMoveOwnership]);

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
      const classification = getDeliveryClassification(wakeSnapshot);
      if (classification === 'local-echo') {
        acknowledgeLocalMoveEcho(roomId, wakeSnapshot, wakeSnapshot);
        return;
      }
      if (classification === 'stale') return;
      const wakeSequence = Number(wakeSnapshot.lastSequence ?? appliedSequence);
      if (!shouldApplyAuthoritativeWake({
        roomMatches: params.activeRoomIdRef.current === roomId,
        appliedSequence: wakeSequence,
        lastAppliedSequence: params.lastAppliedSequenceRef.current,
        deferred: false,
      })) return;
      rememberAuthoritativeLifecycle(wakeSnapshot);
      latestSyncedStateRef.current = wakeSnapshot;
      applySyncedStateSnapshotRef.current(wakeSnapshot, {
        allowMoveAnimation: false,
        allowRollAnimation: false,
        updateVersion: false,
        updateSequence: false,
      });
    }, 0);
  }, [acknowledgeLocalMoveEcho, clearAuthoritativeApplyWake, getDeliveryClassification, params.activeRoomIdRef, params.lastAppliedSequenceRef, rememberAuthoritativeLifecycle]);

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
    localMoveLedger.clearRoom(previousRoomId);
    hardResyncPromisesRef.current.clear();
    statelessDuplicateRecoveryPromisesRef.current.clear();
    authoritativeLifecycleKeyRef.current = '';
    latestSyncedStateRef.current = null;
    queuesRef.current?.reset();
    setManualSequenceSyncing(false);
    params.clearPendingLocalRemoteActions();
    clearTimeoutRollMutationAliases(previousRoomId);
  }, [clearAuthoritativeApplyWake, params.activeRoomId, params.clearPendingLocalRemoteActions]);

  useEffect(() => clearAuthoritativeApplyWake, [clearAuthoritativeApplyWake]);

  const enqueueAuthoritativeResultApplication = useCallback(<T,>(roomId: string, applyResult: () => Promise<T> | T): Promise<T | null> => {
    return queuesRef.current!.enqueueAuthoritativeResultApplication(roomId, async () => {
      const result = await applyResult();
      return aliasTimeoutRollMutationIds(roomId, result);
    });
  }, []);

  const rememberAndApplySyncedStateSnapshot = useCallback((state: SequenceStateSnapshot, options?: SnapshotApplyOptions) => {
    const roomId = params.activeRoomIdRef.current;
    const rawAliasedState = aliasTimeoutRollMutationIds(roomId, state);
    const aliasedState = getAuthoritativeSnapshot<SequenceStateSnapshot>(rawAliasedState, null);
    if (!aliasedState) return;
    rememberAuthoritativeLifecycle(aliasedState);
    const classification = getDeliveryClassification(aliasedState);
    if (classification === 'local-echo') {
      acknowledgeLocalMoveEcho(roomId, aliasedState, aliasedState);
      return;
    }
    if (classification === 'stale') return;
    latestSyncedStateRef.current = aliasedState;
    applySyncedStateSnapshotRef.current(aliasedState, options);
  }, [acknowledgeLocalMoveEcho, getDeliveryClassification, params.activeRoomIdRef, rememberAuthoritativeLifecycle]);

  useGameSyncSubscription({
    activeRoomId: params.activeRoomId,
    lastAppliedSequenceRef: params.lastAppliedSequenceRef,
    lastAppliedStateVersionRef: params.lastAppliedStateVersionRef,
    applyingSyncedStateRef: params.applyingSyncedStateRef,
    replayMissingSequencesThenApply: async (state, localSequence, remoteSequence) => {
      const rawAliasedState = aliasTimeoutRollMutationIds(params.activeRoomId, state);
      const aliasedState = getAuthoritativeSnapshot<SequenceStateSnapshot>(rawAliasedState, null);
      if (!aliasedState) return;
      rememberAuthoritativeLifecycle(aliasedState);
      const classification = getDeliveryClassification(aliasedState);
      if (classification === 'local-echo') {
        acknowledgeLocalMoveEcho(params.activeRoomId, aliasedState, aliasedState);
        return;
      }
      if (classification === 'stale') return;
      latestSyncedStateRef.current = aliasedState;
      await withGameSequenceReplayCache(
        params.activeRoomId,
        localSequence,
        remoteSequence,
        getSequenceRefetchAfter(localSequence),
        () => params.replayMissingSequencesThenApply(aliasedState, localSequence, remoteSequence),
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

  const enqueueAuthoritativeGameAction = useCallback((
    roomId: string,
    action: CommittableGameAction,
    handleResult: (result: AuthoritativeCommitResult) => Promise<void> | void,
    handleError: (error: unknown) => void,
    handleFinally: () => void,
  ) => {
    const attachedAction = attachClientActionStartedAt(action);
    prepareAndFinalizeLocalMove(roomId, attachedAction);
    if (!isTimedOutRollAction(attachedAction)) {
      queuesRef.current!.enqueueAuthoritativeGameAction(roomId, attachedAction, {
        handleResult: async (result) => {
          const moveResultDelayMs = attachedAction.type === 'move_piece' ? getQaMovePieceActionDelayMs() : 0;
          if (moveResultDelayMs) await waitUntil(Date.now() + moveResultDelayMs);
          const actionKey = getClientActionId(attachedAction);
          const aliasedResult = aliasTimeoutRollMutationIds(roomId, result);
          const ackClassification = classifyLocalMoveCommitAck({
            actionType: attachedAction.type,
            actionKey,
            ownsLocalMove: localMoveLedger.has(actionKey),
            status: result.status,
            sequence: result.sequence,
            stateAfter: aliasedResult.stateAfter,
            patch: aliasedResult.patch,
          });
          if (ackClassification === 'stateful') {
            acknowledgeLocalMoveEcho(roomId, {
              ...aliasedResult,
              payload: {
                ...(aliasedResult.payload ?? {}),
                clientMutationId: actionKey,
              },
            });
            return;
          }
          if (ackClassification === 'stateless-duplicate') {
            await recoverStatelessDuplicateLocalMove(roomId, actionKey, aliasedResult);
            return;
          }
          if (attachedAction.type === 'move_piece'
            && actionKey
            && localMoveLedger.has(actionKey)
            && (result.status === 'rejected' || result.status === 'unsupported')) {
            await runLocalMoveHardResync(
              roomId,
              actionKey,
              result.reason ?? `서버가 move_piece 액션을 거부했습니다. actionKey=${actionKey}`,
            );
            return;
          }
          await handleResult(result);
        },
        handleError: (error) => {
          const actionKey = getClientActionId(attachedAction);
          if (attachedAction.type === 'move_piece' && actionKey && localMoveLedger.has(actionKey)) {
            void runLocalMoveHardResync(
              roomId,
              actionKey,
              `move_piece 제출 오류로 최신 authoritative 상태를 적용합니다. actionKey=${actionKey}`,
            );
            return;
          }
          handleError(error);
        },
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
  }, [acknowledgeLocalMoveEcho, commitCanonicalAction, prepareAndFinalizeLocalMove, recoverStatelessDuplicateLocalMove, runLocalMoveHardResync]);

  const applyAuthoritativeResultSequence = useCallback(async (result: AuthoritativeCommitResult) => {
    const roomId = params.activeRoomIdRef.current;
    const aliasedResult = aliasTimeoutRollMutationIds(roomId, result);
    const classification = getDeliveryClassification(aliasedResult);
    if (classification === 'local-echo') {
      const identity = getAuthoritativeDeliveryIdentity(aliasedResult);
      const ackClassification = classifyLocalMoveCommitAck({
        actionType: 'move_piece',
        actionKey: identity.clientMutationId,
        ownsLocalMove: localMoveLedger.has(identity.clientMutationId),
        status: result.status,
        sequence: result.sequence,
        stateAfter: result.stateAfter,
        patch: result.patch,
      });
      if (ackClassification === 'stateless-duplicate') {
        return recoverStatelessDuplicateLocalMove(roomId, identity.clientMutationId, result);
      }
      return acknowledgeLocalMoveEcho(roomId, aliasedResult);
    }
    if (classification === 'stale') return null;
    const applied = await params.applyAuthoritativeResultSequence(aliasedResult);
    const appliedState = getAuthoritativeSnapshot<SequenceStateSnapshot>(applied, null)
      ?? getAuthoritativeSnapshot<SequenceStateSnapshot>(aliasedResult, latestSyncedStateRef.current);
    if (appliedState) {
      rememberAuthoritativeLifecycle(appliedState);
      latestSyncedStateRef.current = appliedState;
    }
    return applied;
  }, [acknowledgeLocalMoveEcho, getDeliveryClassification, params.activeRoomIdRef, params.applyAuthoritativeResultSequence, recoverStatelessDuplicateLocalMove, rememberAuthoritativeLifecycle]);

  const syncLatestAuthoritativeState = useCallback((reason: string, options?: SyncLatestOptions) => {
    const roomId = params.activeRoomIdRef.current;
    const activeLocalMove = localMoveLedger.findByRoom(roomId);
    if (!activeLocalMove) return params.syncLatestAuthoritativeState(reason, options);
    if (activeLocalMove.hardResyncStarted) {
      return runLocalMoveHardResync(roomId, activeLocalMove.clientMutationId, reason);
    }
    return Promise.resolve(true);
  }, [params.activeRoomIdRef, params.syncLatestAuthoritativeState, runLocalMoveHardResync]);

  const syncLatestSequencesFromBadge = useCallback(async () => {
    const roomId = params.activeRoomIdRef.current;
    const activeLocalMove = localMoveLedger.findByRoom(roomId);
    if (!activeLocalMove) {
      await params.syncLatestSequencesFromBadge();
      return;
    }
    if (activeLocalMove.hardResyncStarted) {
      await runLocalMoveHardResync(roomId, activeLocalMove.clientMutationId, '로컬 말 이동 불일치로 최신 sequence를 적용합니다.');
    }
  }, [params.activeRoomIdRef, params.syncLatestSequencesFromBadge, runLocalMoveHardResync]);

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

  const clearPendingLocalRemoteActions = useCallback(() => {
    localMovePresentationLifecycle.cancel();
    localMoveLedger.clearRoom(params.activeRoomIdRef.current);
    params.clearPendingLocalRemoteActions();
  }, [params.activeRoomIdRef, params.clearPendingLocalRemoteActions]);

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
