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

type PendingMoveRuntimeState = {
  turnDeadlineExpired?: boolean;
  turnDeadlineAt?: number;
  turnDeadlineKind?: string;
  autoPlayBySeatId?: Record<string, boolean>;
  activeSeat?: { id?: string; isAI?: boolean } | null;
};

const getPendingMoveRuntimeState = (): PendingMoveRuntimeState => {
  const state = (globalThis as typeof globalThis & {
    __YUT_DEBUG_STATE__?: PendingMoveRuntimeState;
  }).__YUT_DEBUG_STATE__;
  return state && typeof state === 'object' ? state : {};
};

export function shouldPrepareAtomicLocalMoveStart({
  actionKey,
  type,
  optimisticApplied,
  runtimeState = getPendingMoveRuntimeState(),
}: {
  actionKey: string;
  type: GameAction['type'];
  optimisticApplied: boolean;
  runtimeState?: PendingMoveRuntimeState;
}) {
  if (type !== 'move_piece' || !optimisticApplied || !requiresPendingLocalMoveOwnership(actionKey)) return false;
  const actorId = actionKey.split(':')[1] ?? '';
  const moveDeadlineAt = Number(runtimeState.turnDeadlineAt ?? 0);
  const automatedByTimeout = runtimeState.turnDeadlineExpired === true
    || (runtimeState.turnDeadlineKind === 'move' && moveDeadlineAt > 0 && Date.now() >= moveDeadlineAt);
  const automatedBySeat = Boolean(actorId && runtimeState.autoPlayBySeatId?.[actorId]);
  const automatedAiSeat = Boolean(actorId && runtimeState.activeSeat?.id === actorId && runtimeState.activeSeat.isAI);
  return !automatedByTimeout && !automatedBySeat && !automatedAiSeat;
}

class PendingLocalMoveStartError extends Error {
  constructor(actionKey: string, reason: string) {
    super(`로컬 말 이동 시작 준비에 실패했습니다. actionKey=${actionKey}, reason=${reason}`);
    this.name = 'PendingLocalMoveStartError';
  }
}

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
    const type = meta.type ?? getPendingLocalRemoteActionType(actionKey);
    const optimisticApplied = getPendingRemoteActionOptimisticApplied(actionKey, { type, optimisticApplied: meta.optimisticApplied, blocksTurnActions: meta.blocksTurnActions });
    const requiresAtomicLocalMoveStart = shouldPrepareAtomicLocalMoveStart({ actionKey, type, optimisticApplied });
    if (pendingLocalRemoteActionsRef.current.has(actionKey)) {
      if (requiresAtomicLocalMoveStart) throw new PendingLocalMoveStartError(actionKey, 'already-pending');
      return false;
    }
    if (requiresAtomicLocalMoveStart) {
      if (!ensureMoveActionClaimed(actionKey)) {
        throw new PendingLocalMoveStartError(actionKey, 'claim-rejected');
      }
      if (!preparePendingLocalMoveOwnership(actionKey)) {
        releaseMoveActionClaim(actionKey);
        throw new PendingLocalMoveStartError(actionKey, 'ownership-rejected');
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
    releaseMoveActionClaim(clientMutationId);
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
