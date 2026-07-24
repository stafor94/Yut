export function shouldDeliverRoomSnapshot(exists: boolean, fromCache: boolean) {
  return exists || !fromCache;
}
