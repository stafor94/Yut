import type { ItemType } from '../../features/items/logic/items';

type OwnedItemsListener = () => void;

let currentOwnedItems: readonly ItemType[] = [];
const listeners = new Set<OwnedItemsListener>();

export function getOwnedItemsPresentation() {
  return currentOwnedItems;
}

export function subscribeOwnedItemsPresentation(listener: OwnedItemsListener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function publishOwnedItemsPresentation(nextOwnedItems: readonly ItemType[]) {
  if (
    currentOwnedItems.length === nextOwnedItems.length
    && currentOwnedItems.every((item, index) => item === nextOwnedItems[index])
  ) return;

  currentOwnedItems = [...nextOwnedItems];
  listeners.forEach((listener) => listener());
}
