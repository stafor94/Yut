import { useRef, useState } from 'react';
import type { GameAction } from '../../features/room/services/roomService';
import {
  beginLocalMovePresentationForPendingAction,
  localMovePresentationLifecycle,
} from '../flows/localMovePresentationLifecycle';
import {
  clearMoveActionClaims,
  releaseMoveActionClaim,
} from '../flows/moveExecutionPolicy';
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
  const localClientMutationIdsRef = useRef<Set<string>>(new Set());
  const pendingLocalRemoteActionsRef = useRef<Set<string>>(new Set());
  const rejectedRemoteActionKeysRef = useRef<Set<string>>(new Set());
  const pendingLocalRemoteActionMetaRef = useRef<PendingRemoteActionMetaStore<PendingRemoteActionMeta>>(
    new PendingRemoteActionMetaStore<PendingRemoteActionMeta>(),
  );

  const syncPendingLocalRemoteActionCount = () => setPendingLocalRemoteActionCount(pendingLocalRemoteActionsRef.current.size);
  const getPendingLocalRemoteActionType = (actionKey: string): GameAction['type'] => {
    const [type] = actionKey.split(':');
    return (type || 'roll_yut') as GameAction['type'];
  };
  const addPendingLocalRemoteAction = (actionKey: string, meta: Partial<PendingRemoteActionMeta> & { type?: GameAction['type'] } = {}) => {
    if (pendingLocalRemoteActionsRef.current.has(actionKey)) return false;
    const type = meta.type ?? getPendingLocalRemoteActionType(actionKey);
    const optimisticApplied = getPendingRemoteActionOptimisticApplied(actionKey, { type, optimisticApplied: meta.optimisticApplied, blocksTurnActions: meta.blocksTurnActions });
    pendingLocalRemoteActionsRef.current.add(actionKey);
    beginLocalMovePresentationForPendingAction({
      lifecycle: localMovePresentationLifecycle,
      actionKey,
      actionType: type,
      optimisticApplied,
    });
    pendingLocalRemoteActionMetaRef.current.set(actionKey, {
      ...meta,
      type,
      optimisticApplied,
      createdAt: meta.createdAt ?? Date.now(),
    });
    syncPendingLocalRemoteActionCount();
    return true;
  };
  const deletePendingLocalRemoteAction = (actionKey: string) => {
    pendingLocalRemoteActionsRef.current.delete(actionKey);
    pendingLocalRemoteActionMetaRef.current.delete(actionKey);
    releaseMoveActionClaim(actionKey);
    syncPendingLocalRemoteActionCount();
  };
  const acknowledgePendingLocalRemoteAction = (clientMutationId: unknown) => {
    if (typeof clientMutationId !== 'string' || !clientMutationId) return;
    if (!pendingLocalRemoteActionsRef.current.delete(clientMutationId)) return;
    pendingLocalRemoteActionMetaRef.current.acknowledge(clientMutationId);
    syncPendingLocalRemoteActionCount();
  };
  const clearPendingLocalRemoteActions = () => {
    pendingLocalRemoteActionsRef.current.clear();
    pendingLocalRemoteActionMetaRef.current.clear();
    clearMoveActionClaims();
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
