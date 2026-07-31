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

let activeRoomId = '';
let activeTimeoutDeadlineAt = 0;
const candidatesByActionKey = new Map<string, TimeoutRollClientFallbackCandidate>();
const listeners = new Set<TimeoutRollClientFallbackListener>();

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
  if (!activeRoomId || !localClientMutationId || !actorId || activeTimeoutDeadlineAt <= 0) return null;
  const candidate = Object.freeze({
    roomId: activeRoomId,
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
