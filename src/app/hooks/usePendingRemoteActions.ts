import { useEffect, useRef, useState } from 'react';
import { commitAuthoritativeGameAction, type GameAction } from '../../features/room/services/roomService';
import { getTurnRecoveryDeadlineAt } from '../../features/room/services/roomTiming';
import {
  canonicalizeTimeoutRollAction,
  registerPendingTimeoutRollCandidate,
  removePendingTimeoutRollCandidate,
} from '../../features/room/services/timeoutRollActionIdentity';
import {
  registerTimeoutRollClientFallback,
  settleTimeoutRollClientFallback,
  type TimeoutRollClientFallbackCandidate,
} from '../../features/room/services/timeoutRollClientFallback';
import { makeTimeoutActionKey } from '../../features/room/services/timeoutResolvers';
import { shouldFailQaTimeoutRollCommit } from '../config/qaDelays';
import { PendingRemoteActionMetaStore } from './pendingRemoteActionMetaStore';
import { getPendingRemoteActionOptimisticApplied } from './pendingRemoteActionPolicy';

export type PendingRemoteActionMeta = {
  type: GameAction['type'];
  createdAt: number;
  createdSequence?: number;
  createdTurnIndex?: number;
  actorId?: string;
  optimisticApplied?: boolean;
  blocksTurnActions?: boolean;
};

const getVisibleTimeoutDeadlineAt = () => {
  if (typeof document === 'undefined') return 0;
  const timingMeter = document.querySelector<HTMLElement>('.roll-timing-live-meter');
  const timingDeadlineAt = Number(timingMeter?.dataset.timingDeadlineAt ?? 0);
  if (Number.isFinite(timingDeadlineAt) && timingDeadlineAt > 0) return Math.trunc(timingDeadlineAt);
  const turnTimer = document.querySelector<HTMLElement>('.turn-action-timer');
  const turnDeadlineAt = Number(turnTimer?.dataset.deadlineAt ?? 0);
  return Number.isFinite(turnDeadlineAt) && turnDeadlineAt > 0 ? Math.trunc(turnDeadlineAt) : 0;
};

export function usePendingRemoteActions() {
  const [pendingLocalRemoteActionCount, setPendingLocalRemoteActionCount] = useState(0);
  const pendingLocalRemoteActionsRef = useRef<Set<string>>(new Set());
  const rejectedRemoteActionKeysRef = useRef<Set<string>>(new Set());
  const pendingLocalRemoteActionMetaRef = useRef<PendingRemoteActionMetaStore<PendingRemoteActionMeta>>(
    new PendingRemoteActionMetaStore<PendingRemoteActionMeta>(),
  );
  const localClientMutationIdsRef = useRef<Set<string>>(new Set());
  const timeoutRollFallbackTimersRef = useRef<Map<string, number>>(new Map());

  const syncPendingLocalRemoteActionCount = () => setPendingLocalRemoteActionCount(pendingLocalRemoteActionsRef.current.size);
  const getPendingLocalRemoteActionType = (actionKey: string): GameAction['type'] => {
    const [type] = actionKey.split(':');
    return (type || 'roll_yut') as GameAction['type'];
  };
  const clearTimeoutFallbackTimer = (actionKey: string) => {
    const timer = timeoutRollFallbackTimersRef.current.get(actionKey);
    if (timer !== undefined && typeof window !== 'undefined') window.clearTimeout(timer);
    timeoutRollFallbackTimersRef.current.delete(actionKey);
  };
  const scheduleTimeoutFallback = (candidate: TimeoutRollClientFallbackCandidate) => {
    if (typeof window === 'undefined') return;
    clearTimeoutFallbackTimer(candidate.localClientMutationId);
    const canonicalActionId = makeTimeoutActionKey({
      roomId: candidate.roomId,
      stage: 'roll',
      actorId: candidate.actorId,
      timeoutDeadlineAt: candidate.timeoutDeadlineAt,
    });
    const fallbackAction = canonicalizeTimeoutRollAction(candidate.roomId, {
      type: 'roll_yut' as const,
      actorId: candidate.actorId,
      payload: {
        timedOut: true,
        timeoutDeadlineAt: candidate.timeoutDeadlineAt,
        timeoutRecoveredBy: candidate.actorId,
        timeoutSource: 'client-timeout-fallback',
        clientActionId: canonicalActionId,
      },
    });
    const commitOnce = () => {
      if (shouldFailQaTimeoutRollCommit(canonicalActionId)) {
        return Promise.reject(new Error('QA timeout roll commit failure'));
      }
      return commitAuthoritativeGameAction(candidate.roomId, fallbackAction);
    };
    const timer = window.setTimeout(() => {
      timeoutRollFallbackTimersRef.current.delete(candidate.localClientMutationId);
      void commitOnce().catch(() => commitOnce()).catch(() => undefined);
    }, Math.max(0, getTurnRecoveryDeadlineAt(candidate.timeoutDeadlineAt) - Date.now()));
    timeoutRollFallbackTimersRef.current.set(candidate.localClientMutationId, timer);
  };
  const registerTimeoutFallback = (actionKey: string, type: GameAction['type'], actorId?: string) => {
    if (type !== 'roll_yut' || !actorId) return;
    const candidate = registerTimeoutRollClientFallback(actionKey, actorId, getVisibleTimeoutDeadlineAt());
    if (!candidate) return;
    if (!registerPendingTimeoutRollCandidate(candidate.roomId, actionKey, actorId)) {
      settleTimeoutRollClientFallback(actionKey);
      return;
    }
    scheduleTimeoutFallback(candidate);
  };
  const settleTimeoutFallback = (actionKey: string) => {
    clearTimeoutFallbackTimer(actionKey);
    const candidate = settleTimeoutRollClientFallback(actionKey);
    if (candidate) removePendingTimeoutRollCandidate(candidate.roomId, actionKey);
  };
  const addPendingLocalRemoteAction = (actionKey: string, meta: Partial<PendingRemoteActionMeta> & { type?: GameAction['type'] } = {}) => {
    const type = meta.type ?? getPendingLocalRemoteActionType(actionKey);
    const optimisticApplied = getPendingRemoteActionOptimisticApplied(actionKey, { type, optimisticApplied: meta.optimisticApplied, blocksTurnActions: meta.blocksTurnActions });
    registerTimeoutFallback(actionKey, type, meta.actorId);
    pendingLocalRemoteActionsRef.current.add(actionKey);
    pendingLocalRemoteActionMetaRef.current.set(actionKey, {
      ...meta,
      type,
      optimisticApplied,
      createdAt: meta.createdAt ?? Date.now(),
    });
    syncPendingLocalRemoteActionCount();
  };
  const deletePendingLocalRemoteAction = (actionKey: string) => {
    settleTimeoutFallback(actionKey);
    pendingLocalRemoteActionsRef.current.delete(actionKey);
    pendingLocalRemoteActionMetaRef.current.delete(actionKey);
    syncPendingLocalRemoteActionCount();
  };
  const acknowledgePendingLocalRemoteAction = (clientMutationId: unknown) => {
    if (typeof clientMutationId !== 'string' || !clientMutationId) return;
    settleTimeoutFallback(clientMutationId);
    if (!pendingLocalRemoteActionsRef.current.delete(clientMutationId)) return;
    pendingLocalRemoteActionMetaRef.current.acknowledge(clientMutationId);
    syncPendingLocalRemoteActionCount();
  };
  const clearPendingLocalRemoteActions = () => {
    [...pendingLocalRemoteActionsRef.current].forEach(settleTimeoutFallback);
    pendingLocalRemoteActionsRef.current.clear();
    pendingLocalRemoteActionMetaRef.current.clear();
    syncPendingLocalRemoteActionCount();
  };

  useEffect(() => () => {
    timeoutRollFallbackTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    timeoutRollFallbackTimersRef.current.clear();
  }, []);

  return {
    pendingLocalRemoteActionCount,
    pendingLocalRemoteActionsRef,
    rejectedRemoteActionKeysRef,
    pendingLocalRemoteActionMetaRef,
    localClientMutationIdsRef,
    getPendingLocalRemoteActionType,
    addPendingLocalRemoteAction,
    deletePendingLocalRemoteAction,
    acknowledgePendingLocalRemoteAction,
    clearPendingLocalRemoteActions,
  };
}
