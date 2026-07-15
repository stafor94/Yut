import type { ItemType } from '../../features/items/logic/items';

type OwnedItemsListener = () => void;

type OwnedItemsPresentation = {
  itemMode: boolean;
  items: readonly ItemType[];
};

let currentPresentation: OwnedItemsPresentation = {
  itemMode: false,
  items: [],
};
const listeners = new Set<OwnedItemsListener>();

export function getOwnedItemsPresentation() {
  return currentPresentation;
}

export function subscribeOwnedItemsPresentation(listener: OwnedItemsListener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function publishOwnedItemsPresentation(nextItems: readonly ItemType[], itemMode: boolean) {
  if (
    currentPresentation.itemMode === itemMode
    && currentPresentation.items.length === nextItems.length
    && currentPresentation.items.every((item, index) => item === nextItems[index])
  ) return;

  currentPresentation = {
    itemMode,
    items: [...nextItems],
  };
  listeners.forEach((listener) => listener());
}
