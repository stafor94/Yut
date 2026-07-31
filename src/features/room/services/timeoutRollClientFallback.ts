export type TimeoutRollClientFallbackCandidate = Readonly<{
  roomId: string;
  localClientMutationId: string;
  actorId: string;
  timeoutDeadlineAt: number;
  timingPositionPercent: number;
}>;

const ACTIVE_ROOM_STORAGE_KEY = 'yut-online:activeRoomId';
const candidatesByActionKey = new Map<string, TimeoutRollClientFallbackCandidate>();

const getActiveRoomId = () => {
  try {
    return globalThis.window?.localStorage?.getItem(ACTIVE_ROOM_STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
};

export function registerTimeoutRollClientFallback(
  localClientMutationId: string,
  actorId: string,
  timeoutDeadlineAt: number,
  timingPositionPercent: number,
): TimeoutRollClientFallbackCandidate | null {
  const roomId = getActiveRoomId();
  const normalizedDeadlineAt = Math.trunc(Number(timeoutDeadlineAt) || 0);
  const normalizedPositionPercent = Number(timingPositionPercent);
  if (!roomId || !localClientMutationId || !actorId || normalizedDeadlineAt <= 0 || !Number.isFinite(normalizedPositionPercent)) return null;
  const candidate = Object.freeze({
    roomId,
    localClientMutationId,
    actorId,
    timeoutDeadlineAt: normalizedDeadlineAt,
    timingPositionPercent: normalizedPositionPercent,
  });
  candidatesByActionKey.set(localClientMutationId, candidate);
  return candidate;
}

export function settleTimeoutRollClientFallback(localClientMutationId: string) {
  const candidate = candidatesByActionKey.get(localClientMutationId) ?? null;
  if (candidate) candidatesByActionKey.delete(localClientMutationId);
  return candidate;
}
