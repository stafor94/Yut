export type TimeoutRollClientFallbackCandidate = Readonly<{
  roomId: string;
  localClientMutationId: string;
  actorId: string;
  timeoutDeadlineAt: number;
}>;

type TimeoutRollClientFallbackListener = {
  onRegistered?: (candidate: TimeoutRollClientFallbackCandidate) => void;
  onSettled?: (candidate: TimeoutRollClientFallbackCandidate) => void;
};

const ACTIVE_ROOM_STORAGE_KEY = 'yut-online:activeRoomId';
let activeRoomId = '';
let activeTimeoutDeadlineAt = 0;
const candidatesByActionKey = new Map<string, TimeoutRollClientFallbackCandidate>();
const listeners = new Set<TimeoutRollClientFallbackListener>();

const getActiveRoomId = () => {
  if (activeRoomId) return activeRoomId;
  try {
    return globalThis.window?.localStorage?.getItem(ACTIVE_ROOM_STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
};

export function setTimeoutRollClientRoomId(roomId: string) {
  activeRoomId = roomId;
}

export function runWithTimeoutRollClientDeadline<T>(timeoutDeadlineAt: number, operation: () => T): T {
  const previousDeadlineAt = activeTimeoutDeadlineAt;
  activeTimeoutDeadlineAt = Math.trunc(Number(timeoutDeadlineAt) || 0);
  try {
    return operation();
  } finally {
    activeTimeoutDeadlineAt = previousDeadlineAt;
  }
}

export function registerTimeoutRollClientFallback(
  localClientMutationId: string,
  actorId: string,
): TimeoutRollClientFallbackCandidate | null {
  const roomId = getActiveRoomId();
  if (!roomId || !localClientMutationId || !actorId || activeTimeoutDeadlineAt <= 0) return null;
  const candidate = Object.freeze({
    roomId,
    localClientMutationId,
    actorId,
    timeoutDeadlineAt: activeTimeoutDeadlineAt,
  });
  candidatesByActionKey.set(localClientMutationId, candidate);
  listeners.forEach((listener) => listener.onRegistered?.(candidate));
  return candidate;
}

export function settleTimeoutRollClientFallback(localClientMutationId: string) {
  const candidate = candidatesByActionKey.get(localClientMutationId) ?? null;
  if (!candidate) return null;
  candidatesByActionKey.delete(localClientMutationId);
  listeners.forEach((listener) => listener.onSettled?.(candidate));
  return candidate;
}

export function clearTimeoutRollClientFallbacks(roomId: string) {
  [...candidatesByActionKey.values()]
    .filter((candidate) => candidate.roomId === roomId)
    .forEach((candidate) => settleTimeoutRollClientFallback(candidate.localClientMutationId));
}

export function subscribeTimeoutRollClientFallbacks(listener: TimeoutRollClientFallbackListener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
