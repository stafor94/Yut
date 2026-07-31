import { useRef, useState } from 'react';
import type { GameAction } from '../../features/room/services/roomService';
import {
  registerPendingTimeoutRollCandidate,
  removePendingTimeoutRollCandidate,
} from '../../features/room/services/timeoutRollActionIdentity';
import {
  registerTimeoutRollClientFallback,
  settleTimeoutRollClientFallback,
} from '../../features/room/services/timeoutRollClientFallback';
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

export function usePendingRemoteActions() {
  const [pendingLocalRemoteActionCount, setPendingLocalRemoteActionCount] = useState(0);
  const pendingLocalRemoteActionsRef = useRef<Set<string>>(new Set());
  const rejectedRemoteActionKeysRef = useRef<Set<string>>(new Set());
  const pendingLocalRemoteActionMetaRef = useRef<PendingRemoteActionMetaStore<PendingRemoteActionMeta>>(
    new PendingRemoteActionMetaStore<PendingRemoteActionMeta>(),
  );
  const localClientMutationIdsRef = useRef<Set<string>>(new Set());

  const syncPendingLocalRemoteActionCount = () => setPendingLocalRemoteActionCount(pendingLocalRemoteActionsRef.current.size);
  const getPendingLocalRemoteActionType = (actionKey: string): GameAction['type'] => {
    const [type] = actionKey.split(':');
    return (type || 'roll_yut') as GameAction['type'];
  };
  const registerTimeoutFallback = (actionKey: string, type: GameAction['type'], actorId?: string) => {
    if (type !== 'roll_yut' || !actorId) return;
    const candidate = registerTimeoutRollClientFallback(actionKey, actorId);
    if (!candidate) return;
    registerPendingTimeoutRollCandidate(candidate.roomId, actionKey, actorId);
  };
  const settleTimeoutFallback = (actionKey: string) => {
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
