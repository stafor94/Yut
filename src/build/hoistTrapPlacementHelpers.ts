export const TRAP_PLACEMENT_HELPER_CONST_BLOCK = `  const isTrapNodeOccupied = (nodeId: string) => pieces.some((piece) => piece.nodeId === nodeId && piece.started && !piece.finished);
  const getTrapCandidateNodeIds = (nodeId: string) => getAdjacentBoardNodeIds(nodeId).filter((candidateNodeId) => candidateNodeId !== 'n01' && !isTrapNodeOccupied(candidateNodeId));`;

export const TRAP_PLACEMENT_HELPER_FUNCTION_BLOCK = `  function isTrapNodeOccupied(nodeId: string) {
    return pieces.some((piece) => piece.nodeId === nodeId && piece.started && !piece.finished);
  }
  function getTrapCandidateNodeIds(nodeId: string) {
    return getAdjacentBoardNodeIds(nodeId).filter((candidateNodeId) => candidateNodeId !== 'n01' && !isTrapNodeOccupied(candidateNodeId));
  }`;

export const UNSAFE_ACTIVE_ROOM_STORAGE_READ = "window.localStorage.getItem(STORAGE_KEYS.activeRoomId) ?? ''";
export const SAFE_ACTIVE_ROOM_STORAGE_READ = "getStoredText(STORAGE_KEYS.activeRoomId, '')";

export function hoistTrapPlacementHelpers(source: string) {
  if (!source.includes(TRAP_PLACEMENT_HELPER_CONST_BLOCK)) {
    throw new Error('App trap placement helper declarations were not found; remove or update the pre-transform after reviewing App.tsx.');
  }

  return source.replace(TRAP_PLACEMENT_HELPER_CONST_BLOCK, TRAP_PLACEMENT_HELPER_FUNCTION_BLOCK);
}

export function replaceUnsafeAppStorageReads(source: string) {
  if (!source.includes(UNSAFE_ACTIVE_ROOM_STORAGE_READ)) {
    throw new Error('App active-room localStorage read was not found; remove or update the pre-transform after reviewing App.tsx.');
  }

  return source.replace(UNSAFE_ACTIVE_ROOM_STORAGE_READ, SAFE_ACTIVE_ROOM_STORAGE_READ);
}
