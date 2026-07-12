export type RoomCreationOperation = 'auth' | 'create' | 'recover';

export class RoomCreationTimeoutError extends Error {
  constructor(public readonly operation: RoomCreationOperation) {
    super(`${operation} operation timed out`);
    this.name = 'RoomCreationTimeoutError';
  }
}

export function withOperationTimeout<T>(operationPromise: Promise<T>, timeoutMs: number, operation: RoomCreationOperation): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timeoutId = setTimeout(() => reject(new RoomCreationTimeoutError(operation)), Math.max(0, timeoutMs));
  });
  return Promise.race([operationPromise, timeoutPromise]).finally(() => {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  });
}

export function createRoomRequestIdentity(rawToken: string) {
  const normalizedToken = rawToken.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80) || `${Date.now()}`;
  return {
    roomId: `room-${normalizedToken}`,
    createRequestId: normalizedToken,
  };
}

export function isRoomTransitionInProgress(previousRoomId: string, nextRoomId: string) {
  return Boolean(nextRoomId && nextRoomId !== previousRoomId);
}

export function isMatchingCreatedRoom(
  room: { id?: string; hostId?: string; createRequestId?: string } | null | undefined,
  request: { roomId: string; hostId: string; createRequestId: string },
) {
  return Boolean(room && room.id === request.roomId && room.hostId === request.hostId && room.createRequestId === request.createRequestId);
}
