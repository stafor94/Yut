export const ROOM_PRESENCE_HEARTBEAT_MS = 15_000;
export const ROOM_PRESENCE_CLEANUP_INTERVAL_MS = 15_000;
export const ROOM_PRESENCE_CLEANUP_LEASE_MS = 25_000;
export const ROOM_PRESENCE_STALE_MS = 45_000;

export type RoomPresenceLeaseState = {
  status?: 'waiting' | 'playing' | 'finished';
  startStatus?: 'idle' | 'requested' | 'cancelled' | 'entering' | 'playing';
  presenceCleanupLeaseOwnerId?: string;
  presenceCleanupLeaseExpiresAt?: number;
  presenceCleanupLeaseVersion?: number;
};

export type RoomPresencePlayerState = {
  id: string;
  isAI?: boolean;
  isSubstitutedByAI?: boolean;
  isSpectator?: boolean;
  seatIndex?: number;
  lastSeen?: unknown;
  joinedAt?: unknown;
};

export type RoomPresenceCleanupAction = 'skip' | 'substitute_ai' | 'remove';
export type RoomPresenceLeaseDecision = {
  status: 'inactive' | 'held' | 'acquire' | 'renew';
  ownerId: string;
  expiresAt: number;
  version: number;
};

const getPresenceTimestampMillis = (value: unknown) => {
  if (value && typeof value === 'object' && 'toMillis' in value && typeof value.toMillis === 'function') return Number(value.toMillis());
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  return 0;
};

export const isPresenceCleanupRoomActive = (room: RoomPresenceLeaseState) => (
  room.status === 'waiting'
  || room.status === 'playing'
  || room.status === 'finished'
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
  && !player.isAI,
);

export const isStaleHumanPresencePlayer = (
  player: RoomPresencePlayerState,
  now = Date.now(),
  staleMs = ROOM_PRESENCE_STALE_MS,
) => {
  if (player.isAI) return false;
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
  const hasPlayerSeat = !player.isSpectator && Number.isInteger(seatIndex) && seatIndex >= 0;
  return isPresenceCleanupRoomActive(room) && (room.status === 'playing' || room.startStatus === 'entering' || room.startStatus === 'playing') && hasPlayerSeat
    ? 'substitute_ai'
    : 'remove';
}
