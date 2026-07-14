import { useRef, useState } from 'react';
import type { ItemTiming } from '../../features/items/logic/items';
import type { GameAction } from '../../features/room/services/roomService';
import { getPendingRemoteActionOptimisticApplied } from './pendingRemoteActionPolicy';

export type PendingRemoteActionMeta = {
  type: GameAction['type'];
  createdAt: number;
  createdSequence?: number;
  createdTurnIndex?: number;
  actorId?: string;
  optimisticApplied?: boolean;
  itemPromptTiming?: ItemTiming | null;
};

type GameDebugStateWindow = typeof window & {
  __YUT_DEBUG_STATE__?: { itemPromptTiming?: unknown };
};

const getCurrentItemPromptTiming = (): ItemTiming | null => {
  if (typeof window === 'undefined') return null;
  const timing = (window as GameDebugStateWindow).__YUT_DEBUG_STATE__?.itemPromptTiming;
  return timing === 'before_roll' || timing === 'after_roll' || timing === 'after_move' ? timing : null;
};

export function usePendingRemoteActions() {
  const [pendingLocalRemoteActionCount, setPendingLocalRemoteActionCount] = useState(0);
  const pendingLocalRemoteActionsRef = useRef<Set<string>>(new Set());
  const rejectedRemoteActionKeysRef = useRef<Set<string>>(new Set());
  const pendingLocalRemoteActionMetaRef = useRef<Map<string, PendingRemoteActionMeta>>(new Map());
  const localClientMutationIdsRef = useRef<Set<string>>(new Set());

  const syncPendingLocalRemoteActionCount = () => setPendingLocalRemoteActionCount(pendingLocalRemoteActionsRef.current.size);
  const getPendingLocalRemoteActionType = (actionKey: string): GameAction['type'] => {
    const [type] = actionKey.split(':');
    return (type || 'roll_yut') as GameAction['type'];
  };
  const addPendingLocalRemoteAction = (actionKey: string, meta: Partial<PendingRemoteActionMeta> & { type?: GameAction['type'] } = {}) => {
    const type = meta.type ?? getPendingLocalRemoteActionType(actionKey);
    const itemPromptTiming = type === 'use_item'
      ? ('itemPromptTiming' in meta ? meta.itemPromptTiming ?? null : getCurrentItemPromptTiming())
      : undefined;
    const optimisticApplied = getPendingRemoteActionOptimisticApplied(actionKey, { type, optimisticApplied: meta.optimisticApplied, itemPromptTiming });
    pendingLocalRemoteActionsRef.current.add(actionKey);
    pendingLocalRemoteActionMetaRef.current.set(actionKey, {
      ...meta,
      type,
      optimisticApplied,
      ...(itemPromptTiming !== undefined ? { itemPromptTiming } : {}),
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
    if (!pendingLocalRemoteActionsRef.current.has(clientMutationId)) return;
    deletePendingLocalRemoteAction(clientMutationId);
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
