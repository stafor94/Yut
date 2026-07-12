export function normalizePresenceGeneration(value: unknown) {
  const generation = Number(value ?? 0);
  return Number.isInteger(generation) && generation >= 0 ? generation : 0;
}

export function nextPresenceGeneration(...values: unknown[]) {
  return Math.max(0, ...values.map(normalizePresenceGeneration)) + 1;
}

export function makePresenceRestoreKey(roomId: string, userId: string, seatIndex: number, generation: unknown) {
  return `${roomId}:${userId}:${seatIndex}:${normalizePresenceGeneration(generation)}`;
}

export function isCurrentPresenceRestoreResult(params: {
  requestVersion: number;
  currentRequestVersion: number;
  requestRoomId: string;
  currentRoomId: string;
  requestUserId: string;
  currentUserId: string;
  observedGeneration: number;
  restoredGeneration: number;
}) {
  return params.requestVersion === params.currentRequestVersion
    && params.requestRoomId === params.currentRoomId
    && params.requestUserId === params.currentUserId
    && params.restoredGeneration > params.observedGeneration;
}
