import { useRef, useState } from 'react';
import type { GameAction } from '../../features/room/services/roomService';
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

const MAX_ACKNOWLEDGED_OPTIMISTIC_ACTIONS = 160;

/**
 * Pending actions and already-presented optimistic actions have different lifetimes.
 * Map iteration and size expose only actions that are still waiting for the server,
 * while get() also keeps a bounded replay-deduplication history after acknowledgement.
 */
export class PendingRemoteActionMetaStore extends Map<string, PendingRemoteActionMeta> {
  private readonly acknowledgedOptimisticActions = new Map<string, PendingRemoteActionMeta>();

  override get(actionKey: string) {
    return super.get(actionKey) ?? this.acknowledgedOptimisticActions.get(actionKey);
  }

  override set(actionKey: string, meta: PendingRemoteActionMeta) {
    this.acknowledgedOptimisticActions.delete(actionKey);
    return super.set(actionKey, meta);
  }

  override delete(actionKey: string) {
    const deletedPending = super.delete(actionKey);
    const deletedAcknowledged = this.acknowledgedOptimisticActions.delete(actionKey);
    return deletedPending || deletedAcknowledged;
  }

  override clear() {
    super.clear();
    this.acknowledgedOptimisticActions.clear();
  }

  acknowledge(actionKey: string) {
    const meta = super.get(actionKey);
    if (!meta) return false;
    super.delete(actionKey);
    if (!meta.optimisticApplied) {
      this.acknowledgedOptimisticActions.delete(actionKey);
      return true;
    }

    this.acknowledgedOptimisticActions.delete(actionKey);
    this.acknowledgedOptimisticActions.set(actionKey, meta);
    while (this.acknowledgedOptimisticActions.size > MAX_ACKNOWLEDGED_OPTIMISTIC_ACTIONS) {
      const oldestActionKey = this.acknowledgedOptimisticActions.keys().next().value;
      if (typeof oldestActionKey !== 'string') break;
      this.acknowledgedOptimisticActions.delete(oldestActionKey);
    }
    return true;
  }
}

export function usePendingRemoteActions() {
  const [pendingLocalRemoteActionCount, setPendingLocalRemoteActionCount] = useState(0);
  const pendingLocalRemoteActionsRef = useRef<Set<string>>(new Set());
  const rejectedRemoteActionKeysRef = useRef<Set<string>>(new Set());
  const pendingLocalRemoteActionMetaRef = useRef<PendingRemoteActionMetaStore>(new PendingRemoteActionMetaStore());
  const localClientMutationIdsRef = useRef<Set<string>>(new Set());

  const syncPendingLocalRemoteActionCount = () => setPendingLocalRemoteActionCount(pendingLocalRemoteActionsRef.current.size);
  const getPendingLocalRemoteActionType = (actionKey: string): GameAction['type'] => {
    const [type] = actionKey.split(':');
    return (type || 'roll_yut') as GameAction['type'];
  };
  const addPendingLocalRemoteAction = (actionKey: string, meta: Partial<PendingRemoteActionMeta> & { type?: GameAction['type'] } = {}) => {
    const type = meta.type ?? getPendingLocalRemoteActionType(actionKey);
    const optimisticApplied = getPendingRemoteActionOptimisticApplied(actionKey, { type, optimisticApplied: meta.optimisticApplied, blocksTurnActions: meta.blocksTurnActions });
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
    pendingLocalRemoteActionsRef.current.delete(actionKey);
    pendingLocalRemoteActionMetaRef.current.delete(actionKey);
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
