export type TimeoutRollClientFallbackCandidate = Readonly<{
  roomId: string;
  localClientMutationId: string;
  actorId: string;
  timeoutDeadlineAt: number;
}>;

const ACTIVE_ROOM_STORAGE_KEY = 'yut-online:activeRoomId';
let activeTimeoutDeadlineAt = 0;
const candidatesByActionKey = new Map<string, TimeoutRollClientFallbackCandidate>();

const getActiveRoomId = () => {
  try {
    return globalThis.window?.localStorage?.getItem(ACTIVE_ROOM_STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
};

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
  return candidate;
}

export function settleTimeoutRollClientFallback(localClientMutationId: string) {
  const candidate = candidatesByActionKey.get(localClientMutationId) ?? null;
  if (candidate) candidatesByActionKey.delete(localClientMutationId);
  return candidate;
}
