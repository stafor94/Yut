import { ITEM_DEFINITIONS, ITEM_TYPES, type ItemTiming } from '../../features/items/logic/items';

type PendingRemoteActionPolicyMeta = {
  type: string;
  optimisticApplied?: boolean;
};

let currentItemPromptTiming: ItemTiming | null = null;

const isItemTiming = (value: unknown): value is ItemTiming => value === 'before_roll' || value === 'after_roll' || value === 'after_move';
const isOptimisticItemSkipAction = (actionKey: string) => actionKey.startsWith('use_item:') && actionKey.endsWith('::');

export function syncPendingRemoteActionItemPromptTiming(itemPromptTiming: unknown) {
  currentItemPromptTiming = isItemTiming(itemPromptTiming) ? itemPromptTiming : null;
}

export function isTurnFinalizingOptimisticItemAction(actionKey: string, meta: PendingRemoteActionPolicyMeta) {
  if (meta.type !== 'use_item' || meta.optimisticApplied !== true) return false;
  const actionKeySegments = new Set(actionKey.split(':'));
  const itemType = ITEM_TYPES.find((type) => actionKeySegments.has(type));
  const itemTiming = itemType
    ? ITEM_DEFINITIONS[itemType].timing
    : isOptimisticItemSkipAction(actionKey)
      ? currentItemPromptTiming
      : null;
  return itemTiming === 'after_move';
}

export function getPendingRemoteActionOptimisticApplied(actionKey: string, meta: PendingRemoteActionPolicyMeta) {
  return isTurnFinalizingOptimisticItemAction(actionKey, meta) ? false : meta.optimisticApplied;
}
