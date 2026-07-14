import { ITEM_DEFINITIONS, ITEM_TYPES, type ItemTiming } from '../../features/items/logic/items';

type PendingRemoteActionPolicyMeta = {
  type: string;
  optimisticApplied?: boolean;
  itemPromptTiming?: ItemTiming | null;
};

const isOptimisticItemSkipAction = (actionKey: string) => actionKey.startsWith('use_item:') && actionKey.endsWith('::');

export function isTurnFinalizingOptimisticItemAction(actionKey: string, meta: PendingRemoteActionPolicyMeta) {
  if (meta.type !== 'use_item' || meta.optimisticApplied !== true) return false;
  const actionKeySegments = new Set(actionKey.split(':'));
  const itemType = ITEM_TYPES.find((type) => actionKeySegments.has(type));
  const itemTiming = itemType
    ? ITEM_DEFINITIONS[itemType].timing
    : isOptimisticItemSkipAction(actionKey)
      ? meta.itemPromptTiming
      : null;
  return itemTiming === 'after_move';
}

export function getPendingRemoteActionOptimisticApplied(actionKey: string, meta: PendingRemoteActionPolicyMeta) {
  return isTurnFinalizingOptimisticItemAction(actionKey, meta) ? false : meta.optimisticApplied;
}
