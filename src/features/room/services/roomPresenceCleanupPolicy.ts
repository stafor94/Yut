export const ROOM_PRESENCE_HEARTBEAT_INTERVAL_MS = 15000;
export const ROOM_PRESENCE_CLEANUP_INTERVAL_MS = 15000;
export const ROOM_PRESENCE_CLEANUP_LEASE_MS = 25000;
export const ROOM_PRESENCE_STALE_MS = 45000;

export type RoomPresenceLeaseState = {
  status?: unknown;
  startStatus?: unknown;
  presenceCleanupLeaseOwnerId?: unknown;
  presenceCleanupLeaseExpiresAt?: unknown;
  presenceCleanupLeaseVersion?: unknown;
};

export type RoomPresenceLeaseDecision =
  | { status: 'acquire' | 'renew'; ownerId: string; expiresAt: number; version: number }
  | { status: 'held'; ownerId: string; expiresAt: number; version: number }
  | { status: 'inactive'; ownerId: string; expiresAt: number; version: number };

export type RoomPresencePlayerState = {
  id: string;
  isAI?: unknown;
  isSpectator?: unknown;
  lastSeen?: unknown;
  joinedAt?: unknown;
  seatIndex?: unknown;
};

export type RoomPresenceCleanupAction = 'skip' | 'substitute_ai' | 'remove';

export const getPresenceTimestampMillis = (value: unknown) => {
  if (value && typeof value === 'object' && 'toMillis' in value && typeof value.toMillis === 'function') {
    const millis = Number(value.toMillis());
    return Number.isFinite(millis) ? millis : 0;
  }
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  return 0;
};

export const isPresenceCleanupRoomActive = (room: RoomPresenceLeaseState) => (
  room.status === 'waiting'
  || room.status === 'playing'
  || room.startStatus === 'entering'
  || room.startStatus === 'playing'
);

export function decideRoomPresenceCleanupLease(
  room: RoomPresenceLeaseState,
  candidatePlayerId: string,
  now = Date.now(),
  leaseMs = ROOM_PRESENCE_CLEANUP_LEASE_MS,
): RoomPresenceLeaseDecision {
  const ownerId = typeof room.presenceCleanupLeaseOwnerId === 'string' ? room.presenceCleanupLeaseOwnerId : '';
  const expiresAt = Number(room.presenceCleanupLeaseExpiresAt ?? 0);
  const version = Number(room.presenceCleanupLeaseVersion ?? 0);
  if (!candidatePlayerId || !isPresenceCleanupRoomActive(room)) return { status: 'inactive', ownerId, expiresAt, version };
  if (ownerId === candidatePlayerId) return { status: 'renew', ownerId: candidatePlayerId, expiresAt: now + leaseMs, version };
  if (!ownerId || !Number.isFinite(expiresAt) || expiresAt <= now) {
    return { status: 'acquire', ownerId: candidatePlayerId, expiresAt: now + leaseMs, version: version + 1 };
  }
  return { status: 'held', ownerId, expiresAt, version };
}

export const isEligiblePresenceCleanupCandidate = (player: RoomPresencePlayerState | null | undefined) => Boolean(
  player
  && player.id
  && !player.isAI
  && !player.isSpectator,
);

export const isStaleHumanPresencePlayer = (
  player: RoomPresencePlayerState,
  now = Date.now(),
  staleMs = ROOM_PRESENCE_STALE_MS,
) => {
  if (player.isAI || player.isSpectator) return false;
  const lastSeen = getPresenceTimestampMillis(player.lastSeen ?? player.joinedAt);
  return !lastSeen || now - lastSeen > staleMs;
};

export function getRoomPresenceCleanupAction(
  room: RoomPresenceLeaseState,
  player: RoomPresencePlayerState,
  now = Date.now(),
  staleMs = ROOM_PRESENCE_STALE_MS,
): RoomPresenceCleanupAction {
  if (!isStaleHumanPresencePlayer(player, now, staleMs)) return 'skip';
  const seatIndex = Number(player.seatIndex);
  const hasSeat = Number.isInteger(seatIndex) && seatIndex >= 0;
  return isPresenceCleanupRoomActive(room) && (room.status === 'playing' || room.startStatus === 'entering' || room.startStatus === 'playing') && hasSeat
    ? 'substitute_ai'
    : 'remove';
}
