import { useEffect, useRef, useState } from 'react';
import type { GameAction } from '../../features/room/services/roomService';
import {
  getRollPresentationActive,
  subscribeRollPresentationActive,
} from '../flows/rollPresentationEvents';
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

const ROLL_PRESENTATION_BLOCKER_ACTION_KEY = '__roll_presentation_active__';
const ROLL_PRESENTATION_BLOCKER_META: PendingRemoteActionMeta = {
  type: 'roll_yut',
  createdAt: 0,
  createdTurnIndex: -1,
  actorId: '',
  optimisticApplied: false,
  blocksTurnActions: true,
};

const publishPendingRemoteActionDebug = (store: PendingRemoteActionMetaStore<PendingRemoteActionMeta>) => {
  if (typeof window === 'undefined') return;
  const debugWindow = window as typeof window & {
    __YUT_PENDING_REMOTE_ACTION_DEBUG__?: {
      rollPresentationActive: boolean;
      entries: Array<{ key: string; type: GameAction['type']; actorId: string; blocksTurnActions: boolean; optimisticApplied: boolean }>;
    };
  };
  debugWindow.__YUT_PENDING_REMOTE_ACTION_DEBUG__ = {
    rollPresentationActive: getRollPresentationActive(),
    entries: Array.from(store.entries()).map(([key, meta]) => ({
      key,
      type: meta.type,
      actorId: meta.actorId ?? '',
      blocksTurnActions: meta.blocksTurnActions !== false,
      optimisticApplied: meta.optimisticApplied === true,
    })),
  };
};

const syncRollPresentationBlockerMeta = (store: PendingRemoteActionMetaStore<PendingRemoteActionMeta>) => {
  if (getRollPresentationActive()) {
    store.set(ROLL_PRESENTATION_BLOCKER_ACTION_KEY, ROLL_PRESENTATION_BLOCKER_META);
  } else {
    store.delete(ROLL_PRESENTATION_BLOCKER_ACTION_KEY);
  }
  publishPendingRemoteActionDebug(store);
};

export function usePendingRemoteActions() {
  const [pendingLocalRemoteActionCount, setPendingLocalRemoteActionCount] = useState(0);
  const [, setRollPresentationVersion] = useState(0);
  const localClientMutationIdsRef = useRef<Set<string>>(new Set());
  const pendingLocalRemoteActionsRef = useRef<Set<string>>(new Set());
  const rejectedRemoteActionKeysRef = useRef<Set<string>>(new Set());
  const pendingLocalRemoteActionMetaRef = useRef<PendingRemoteActionMetaStore<PendingRemoteActionMeta>>(
    new PendingRemoteActionMetaStore<PendingRemoteActionMeta>(),
  );
  syncRollPresentationBlockerMeta(pendingLocalRemoteActionMetaRef.current);

  useEffect(() => subscribeRollPresentationActive(() => {
    syncRollPresentationBlockerMeta(pendingLocalRemoteActionMetaRef.current);
    setRollPresentationVersion((version) => version + 1);
  }), []);

  const syncPendingLocalRemoteActionCount = () => {
    publishPendingRemoteActionDebug(pendingLocalRemoteActionMetaRef.current);
    setPendingLocalRemoteActionCount(Array.from(pendingLocalRemoteActionsRef.current).length);
  };
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
    syncRollPresentationBlockerMeta(pendingLocalRemoteActionMetaRef.current);
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
