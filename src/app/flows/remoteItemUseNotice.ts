import type { ItemType } from '../../features/items/logic/items';

export type OwnedItemsSnapshot = Record<string, ItemType[]>;

export type RemoteConsumedItem = {
  seatId: string;
  itemType: ItemType;
};

export const snapshotOwnedItems = (seatIds: string[], ownedItems: Record<string, ItemType[]>): OwnedItemsSnapshot => Object.fromEntries(
  seatIds.map((seatId) => [seatId, [...(ownedItems[seatId] ?? [])]]),
) as OwnedItemsSnapshot;

export const getRemovedItemTypes = (previousItems: ItemType[], currentItems: ItemType[]) => {
  const unmatchedCurrentItems = [...currentItems];
  return previousItems.filter((itemType) => {
    const matchingIndex = unmatchedCurrentItems.indexOf(itemType);
    if (matchingIndex < 0) return true;
    unmatchedCurrentItems.splice(matchingIndex, 1);
    return false;
  });
};

export function findRemoteConsumedItem(
  seatIds: string[],
  localSeatId: string,
  previousOwnedItems: OwnedItemsSnapshot,
  currentOwnedItems: OwnedItemsSnapshot,
): RemoteConsumedItem | null {
  for (const seatId of seatIds) {
    if (seatId === localSeatId) continue;
    const itemType = getRemovedItemTypes(previousOwnedItems[seatId] ?? [], currentOwnedItems[seatId] ?? [])[0];
    if (itemType) return { seatId, itemType };
  }
  return null;
}
