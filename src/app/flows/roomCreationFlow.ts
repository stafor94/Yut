import { ROOM_CREATION_TIMEOUT_MS } from '../../features/room/services/roomCreationTiming';

export type RoomCreationOperation = 'auth' | 'create' | 'recover';

export class RoomCreationTimeoutError extends Error {
  constructor(public readonly operation: RoomCreationOperation) {
    super(`${operation} operation timed out`);
    this.name = 'RoomCreationTimeoutError';
  }
}

export type RoomCreationTimeoutScheduler = {
  now?: () => number;
  setTimeout?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  clearTimeout?: (timeoutId: ReturnType<typeof setTimeout>) => void;
  requestAnimationFrame?: (callback: (timestamp: number) => void) => number;
  cancelAnimationFrame?: (frameId: number) => void;
};

export function resolveRoomCreationTimeoutMs(timeoutMs: number, operation: RoomCreationOperation) {
  const safeTimeoutMs = Math.max(0, timeoutMs);
  return operation === 'recover'
    ? ROOM_CREATION_TIMEOUT_MS
    : Math.min(safeTimeoutMs, ROOM_CREATION_TIMEOUT_MS);
}

export function withOperationTimeout<T>(
  operationPromise: Promise<T>,
  timeoutMs: number,
  operation: RoomCreationOperation,
  scheduler: RoomCreationTimeoutScheduler = {},
): Promise<T> {
  const now = scheduler.now ?? Date.now;
  const scheduleTimeout = scheduler.setTimeout ?? ((callback, delayMs) => globalThis.setTimeout(callback, delayMs));
  const cancelTimeout = scheduler.clearTimeout ?? ((timeoutId) => globalThis.clearTimeout(timeoutId));
  const scheduleFrame = scheduler.requestAnimationFrame
    ?? (typeof globalThis.requestAnimationFrame === 'function' ? globalThis.requestAnimationFrame.bind(globalThis) : undefined);
  const cancelFrame = scheduler.cancelAnimationFrame
    ?? (typeof globalThis.cancelAnimationFrame === 'function' ? globalThis.cancelAnimationFrame.bind(globalThis) : undefined);
  const deadlineAt = now() + resolveRoomCreationTimeoutMs(timeoutMs, operation);
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let frameId: number | undefined;
  let settled = false;

  const cleanup = () => {
    if (timeoutId !== undefined) {
      cancelTimeout(timeoutId);
      timeoutId = undefined;
    }
    if (frameId !== undefined && cancelFrame) {
      cancelFrame(frameId);
      frameId = undefined;
    }
  };

  const timeoutPromise = new Promise<T>((_, reject) => {
    const rejectAtDeadline = () => {
      if (settled) return;
      if (now() < deadlineAt) return;
      settled = true;
      cleanup();
      reject(new RoomCreationTimeoutError(operation));
    };
    const checkFrameDeadline = () => {
      frameId = undefined;
      if (settled) return;
      rejectAtDeadline();
      if (!settled && scheduleFrame) frameId = scheduleFrame(checkFrameDeadline);
    };

    timeoutId = scheduleTimeout(rejectAtDeadline, Math.max(0, deadlineAt - now()));
    if (scheduleFrame) frameId = scheduleFrame(checkFrameDeadline);
  });

  return Promise.race([operationPromise, timeoutPromise]).finally(() => {
    settled = true;
    cleanup();
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
