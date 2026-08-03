import { useRef, useState } from 'react';
import type { GameAction } from '../../features/room/services/roomService';
import {
  beginLocalMovePresentationForPendingAction,
  localMovePresentationLifecycle,
} from '../flows/localMovePresentationLifecycle';
import {
  clearMoveActionClaims,
  ensureMoveActionClaimed,
  releaseMoveActionClaim,
  tryClaimMoveAction,
} from '../flows/moveExecutionPolicy';
import {
  preparePendingLocalMoveOwnership,
  requiresPendingLocalMoveOwnership,
} from '../flows/pendingLocalMoveOwnership';
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

class PendingLocalRemoteActionSet extends Set<string> {
  override has(actionKey: string) {
    if (!actionKey.startsWith('move_piece:') || super.has(actionKey)) return super.has(actionKey);
    if (!tryClaimMoveAction(actionKey)) return true;
    if (requiresPendingLocalMoveOwnership(actionKey)
      && !preparePendingLocalMoveOwnership(actionKey)) {
      releaseMoveActionClaim(actionKey);
      return true;
    }
    return false;
  }
}

export function usePendingRemoteActions() {
  const [pendingLocalRemoteActionCount, setPendingLocalRemoteActionCount] = useState(0);
  const localClientMutationIdsRef = useRef<Set<string>>(new Set());
  const pendingLocalRemoteActionsRef = useRef<Set<string>>(new PendingLocalRemoteActionSet());
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
    const type = meta.type ?? getPendingLocalRemoteActionType(actionKey);
    const optimisticApplied = getPendingRemoteActionOptimisticApplied(actionKey, { type, optimisticApplied: meta.optimisticApplied, blocksTurnActions: meta.blocksTurnActions });
    if (type === 'move_piece') {
      if (!ensureMoveActionClaimed(actionKey)) return;
      if (requiresPendingLocalMoveOwnership(actionKey)
        && !preparePendingLocalMoveOwnership(actionKey)) {
        releaseMoveActionClaim(actionKey);
        return;
      }
    }
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
