import { ITEM_DEFINITIONS, ITEM_TYPES } from '../../features/items/logic/items';

type PendingRemoteActionPolicyMeta = {
  type: string;
  optimisticApplied?: boolean;
};

export function isTurnFinalizingOptimisticItemAction(actionKey: string, meta: PendingRemoteActionPolicyMeta) {
  if (meta.type !== 'use_item' || meta.optimisticApplied !== true) return false;
  const actionKeySegments = new Set(actionKey.split(':'));
  const itemType = ITEM_TYPES.find((type) => actionKeySegments.has(type));
  return Boolean(itemType && ITEM_DEFINITIONS[itemType].timing === 'after_move');
}

export function getPendingRemoteActionOptimisticApplied(actionKey: string, meta: PendingRemoteActionPolicyMeta) {
  return isTurnFinalizingOptimisticItemAction(actionKey, meta) ? false : meta.optimisticApplied;
}
