import { useEffect, useRef, useState } from 'react';
import type { GameAction } from '../../features/room/services/roomService';
import { gamePresentationLock } from '../../shared/gamePresentationLock';
import {
  beginLocalMovePresentationForPendingAction,
  localMovePresentationLifecycle,
} from '../flows/localMovePresentationLifecycle';
import {
  clearMoveActionClaims,
  releaseMoveActionClaim,
} from '../flows/moveExecutionPolicy';
import {
  clearPendingOptimisticMoveActions,
  forgetPendingOptimisticMoveAction,
  rememberPendingOptimisticMoveAction,
} from '../flows/pendingOptimisticMoveOwnership';
import { PendingRemoteActionMetaStore } from './pendingRemoteActionMetaStore';
import { getPendingRemoteActionOptimisticApplied } from './pendingRemoteActionPolicy';

export { getPendingOptimisticMoveAction } from '../flows/pendingOptimisticMoveOwnership';

export type PendingRemoteActionMeta = {
  type: GameAction['type'];
  createdAt: number;
  createdSequence?: number;
  createdTurnIndex?: number;
  actorId?: string;
  optimisticApplied?: boolean;
  blocksTurnActions?: boolean;
};

const PRESENTATION_BLOCKER_ACTION_KEY = '__roll_presentation_lock__';
const PRESENTATION_BLOCKER_META: PendingRemoteActionMeta = {
  type: 'roll_yut',
  createdAt: 0,
  createdTurnIndex: -1,
  actorId: '',
  optimisticApplied: false,
  blocksTurnActions: true,
};

class PresentationAwarePendingActionSet extends Set<string> {
  override get size() {
    return super.size + (gamePresentationLock.isLocked() ? 1 : 0);
  }
}

export function usePendingRemoteActions() {
  const [pendingLocalRemoteActionCount, setPendingLocalRemoteActionCount] = useState(0);
  const [, setPresentationLockVersion] = useState(0);
  const localClientMutationIdsRef = useRef<Set<string>>(new Set());
  const pendingLocalRemoteActionsRef = useRef<Set<string>>(new PresentationAwarePendingActionSet());
  const rejectedRemoteActionKeysRef = useRef<Set<string>>(new Set());
  const pendingLocalRemoteActionMetaRef = useRef<PendingRemoteActionMetaStore<PendingRemoteActionMeta>>(
    new PendingRemoteActionMetaStore<PendingRemoteActionMeta>(),
  );

  const syncPresentationBlockerMeta = () => {
    if (gamePresentationLock.isLocked()) {
      pendingLocalRemoteActionMetaRef.current.set(PRESENTATION_BLOCKER_ACTION_KEY, PRESENTATION_BLOCKER_META);
      return;
    }
    pendingLocalRemoteActionMetaRef.current.delete(PRESENTATION_BLOCKER_ACTION_KEY);
  };

  useEffect(() => {
    syncPresentationBlockerMeta();
    return gamePresentationLock.subscribe(() => {
      syncPresentationBlockerMeta();
      setPresentationLockVersion((version) => version + 1);
    });
  }, []);

  const syncPendingLocalRemoteActionCount = () => setPendingLocalRemoteActionCount(Array.from(pendingLocalRemoteActionsRef.current).length);
  const getPendingLocalRemoteActionType = (actionKey: string): GameAction['type'] => {
    const [type] = actionKey.split(':');
    return (type || 'roll_yut') as GameAction['type'];
  };
  const addPendingLocalRemoteAction = (actionKey: string, meta: Partial<PendingRemoteActionMeta> & { type?: GameAction['type'] } = {}) => {
    if (pendingLocalRemoteActionsRef.current.has(actionKey)) return false;
    const type = meta.type ?? getPendingLocalRemoteActionType(actionKey);
    const optimisticApplied = getPendingRemoteActionOptimisticApplied(actionKey, { type, optimisticApplied: meta.optimisticApplied, blocksTurnActions: meta.blocksTurnActions });
    const createdAt = meta.createdAt ?? Date.now();
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
      createdAt,
    });
    if (type === 'move_piece' && optimisticApplied && meta.actorId) {
      rememberPendingOptimisticMoveAction({
        actionKey,
        actorId: meta.actorId,
        createdAt,
      });
    }
    syncPendingLocalRemoteActionCount();
    return true;
  };
  const deletePendingLocalRemoteAction = (actionKey: string) => {
    pendingLocalRemoteActionsRef.current.delete(actionKey);
    pendingLocalRemoteActionMetaRef.current.delete(actionKey);
    forgetPendingOptimisticMoveAction(actionKey);
    releaseMoveActionClaim(actionKey);
    syncPendingLocalRemoteActionCount();
  };
  const acknowledgePendingLocalRemoteAction = (clientMutationId: unknown) => {
    if (typeof clientMutationId !== 'string' || !clientMutationId) return;
    const removed = pendingLocalRemoteActionsRef.current.delete(clientMutationId);
    forgetPendingOptimisticMoveAction(clientMutationId);
    if (!removed) return;
    pendingLocalRemoteActionMetaRef.current.acknowledge(clientMutationId);
    releaseMoveActionClaim(clientMutationId);
    syncPendingLocalRemoteActionCount();
  };
  const clearPendingLocalRemoteActions = () => {
    pendingLocalRemoteActionsRef.current.clear();
    pendingLocalRemoteActionMetaRef.current.clear();
    syncPresentationBlockerMeta();
    clearPendingOptimisticMoveActions();
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
