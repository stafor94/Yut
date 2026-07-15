export function resolvePieceStackOrder(
  previousOrder: string[],
  currentPieceIds: string[],
  arrivingPieceIds: string[] = [],
) {
  const currentIds = new Set(currentPieceIds);
  const arrivingIds = new Set(arrivingPieceIds.filter((pieceId) => currentIds.has(pieceId)));
  const retainedIds = previousOrder.filter((pieceId) => currentIds.has(pieceId));
  const appendedIds = currentPieceIds.filter((pieceId) => !retainedIds.includes(pieceId));
  const nextOrder = [...retainedIds, ...appendedIds];

  if (!arrivingIds.size) return nextOrder;

  return [
    ...nextOrder.filter((pieceId) => !arrivingIds.has(pieceId)),
    ...nextOrder.filter((pieceId) => arrivingIds.has(pieceId)),
  ];
}

export const getPieceStackLiftPx = (stackIndex: number) => Math.max(0, stackIndex) * 3;
