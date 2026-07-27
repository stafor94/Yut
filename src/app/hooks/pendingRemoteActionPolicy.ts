import { ITEM_DEFINITIONS, ITEM_TYPES, type ItemType } from '../../features/items/logic/items';

type PendingRemoteActionPolicyMeta = {
  type?: string;
  optimisticApplied?: boolean;
  blocksTurnActions?: boolean;
};

const findItemTypeInActionKey = (actionKey: string): ItemType | null => (
  ITEM_TYPES.find((type) => actionKey.split(':').includes(type)) ?? null
);

export function isTurnFinalizingOptimisticItemAction(actionKey: string, meta?: PendingRemoteActionPolicyMeta) {
  if (meta?.type !== 'use_item' || !meta.optimisticApplied) return false;
  const itemType = findItemTypeInActionKey(actionKey);
  return Boolean(itemType && ITEM_DEFINITIONS[itemType].timing === 'after_move');
}

export function getPendingRemoteActionOptimisticApplied(actionKey: string, meta?: PendingRemoteActionPolicyMeta) {
  if (meta?.blocksTurnActions) return false;
  if (isTurnFinalizingOptimisticItemAction(actionKey, meta)) return false;
  return Boolean(meta?.optimisticApplied);
}
