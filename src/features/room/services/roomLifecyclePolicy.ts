import { ROOM_PRESENCE_STALE_MS } from './roomPresenceCleanupPolicy';

export type RoomLifecycleRoom = {
  status?: 'waiting' | 'playing' | 'finished';
  startStatus?: 'idle' | 'requested' | 'cancelled' | 'entering' | 'playing';
  createdAt?: unknown;
  lastActivityAt?: unknown;
  deletingAt?: unknown;
  emptySince?: unknown;
  currentPlayers?: number;
  systemRoomType?: string;
};

export type RoomLifecycleSeat = {
  status?: 'human' | 'ai_substitute' | 'disconnected' | 'removed';
  aiActive?: boolean;
  isSubstitutedByAI?: boolean;
};

export type RoomLifecyclePlayer = {
  id: string;
  isAI?: boolean;
  isSubstitutedByAI?: boolean;
  isSpectator?: boolean;
  lastSeen?: unknown;
  joinedAt?: unknown;
};

export const ROOM_MAX_IDLE_MS = 2 * 60 * 60 * 1000;
export const ROOM_EMPTY_DELETE_GRACE_MS = 3 * 60 * 1000;
export const ROOM_LIST_CANDIDATE_LIMIT = 10;

export const getRoomTimestampMillis = (value: unknown) => {
  if (value && typeof value === 'object' && 'toMillis' in value && typeof value.toMillis === 'function') {
    return Number(value.toMillis());
  }
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  return 0;
};

export const isSystemRoom = (room: RoomLifecycleRoom) => Boolean(room.systemRoomType);

export const isRoomDeleting = (room: RoomLifecycleRoom) => Boolean(getRoomTimestampMillis(room.deletingAt));

export const isRoomInGameLifecycle = (room: RoomLifecycleRoom) => (
  room.status === 'playing' || room.startStatus === 'entering' || room.startStatus === 'playing'
);

export const isReusableWaitingRoomSeat = (seat: RoomLifecycleSeat | null | undefined) => (
  !seat || (seat.status === 'disconnected' && !seat.aiActive && !seat.isSubstitutedByAI)
);

export const hasRecoverableLifecyclePlayer = (players: RoomLifecyclePlayer[]) => players.some((player) => (
  !player.isAI || player.isSubstitutedByAI === true
));

export const hasCreationBlockingHumanPlayer = (players: RoomLifecyclePlayer[]) => players.some((player) => !player.isAI);

export const hasResumablePlayerForUser = (players: RoomLifecyclePlayer[], userId: string) => players.some((player) => (
  Boolean(userId)
  && player.id === userId
  && !player.isSpectator
  && (!player.isAI || player.isSubstitutedByAI === true)
));

export const hasHumanLifecyclePlayer = (players: RoomLifecyclePlayer[]) => players.some((player) => !player.isAI);

export const isActiveHumanLifecyclePlayer = (
  player: RoomLifecyclePlayer,
  now = Date.now(),
  staleMs = ROOM_PRESENCE_STALE_MS,
) => {
  if (player.isAI) return false;
  const lastSeen = getRoomTimestampMillis(player.lastSeen ?? player.joinedAt);
  return Boolean(lastSeen && now - lastSeen <= staleMs);
};

export const hasActiveHumanLifecyclePlayer = (
  players: RoomLifecyclePlayer[],
  now = Date.now(),
  staleMs = ROOM_PRESENCE_STALE_MS,
) => players.some((player) => isActiveHumanLifecyclePlayer(player, now, staleMs));

export const getRoomLastActivityMillis = (room: RoomLifecycleRoom) => (
  getRoomTimestampMillis(room.lastActivityAt) || getRoomTimestampMillis(room.createdAt)
);

export const getRoomEmptySinceMillis = (room: RoomLifecycleRoom) => getRoomTimestampMillis(room.emptySince);

export const getRoomDeletionDeadlineMillis = (
  room: RoomLifecycleRoom,
  graceMs = ROOM_EMPTY_DELETE_GRACE_MS,
) => {
  const emptySince = getRoomEmptySinceMillis(room);
  return emptySince ? emptySince + graceMs : 0;
};

export const isRoomDeletionGraceActive = (
  room: RoomLifecycleRoom,
  now = Date.now(),
  graceMs = ROOM_EMPTY_DELETE_GRACE_MS,
) => {
  const deadline = getRoomDeletionDeadlineMillis(room, graceMs);
  return Boolean(deadline && now < deadline);
};

export const isRoomDeletionExpired = (
  room: RoomLifecycleRoom,
  now = Date.now(),
  graceMs = ROOM_EMPTY_DELETE_GRACE_MS,
) => {
  const deadline = getRoomDeletionDeadlineMillis(room, graceMs);
  return Boolean(deadline && now >= deadline);
};

export const isRoomIdleExpired = (room: RoomLifecycleRoom, now = Date.now(), maxIdleMs = ROOM_MAX_IDLE_MS) => {
  const lastActivityAt = getRoomLastActivityMillis(room);
  return Boolean(lastActivityAt && now - lastActivityAt > maxIdleMs);
};

export const isRoomSummaryInactive = (room: RoomLifecycleRoom) => {
  if (isSystemRoom(room) || isRoomDeleting(room)) return true;
  if (room.status !== 'waiting' && room.status !== 'playing' && room.status !== 'finished') return true;
  return !getRoomTimestampMillis(room.createdAt);
};

export const shouldStartRoomDeletionGrace = (
  room: RoomLifecycleRoom,
  players: RoomLifecyclePlayer[],
  now = Date.now(),
) => (
  !isSystemRoom(room)
  && !isRoomDeleting(room)
  && !getRoomEmptySinceMillis(room)
  && !hasActiveHumanLifecyclePlayer(players, now)
);

export const shouldDeleteRoomSnapshot = (
  room: RoomLifecycleRoom,
  players: RoomLifecyclePlayer[],
  now = Date.now(),
) => {
  if (isSystemRoom(room)) return false;
  if (isRoomDeleting(room)) return true;
  if (hasActiveHumanLifecyclePlayer(players, now)) return false;
  if (!getRoomTimestampMillis(room.createdAt)) return true;
  return isRoomDeletionExpired(room, now);
};

export const shouldDeferOwnRoomRemoval = (params: {
  roomId: string;
  activeRoomId: string;
  currentUserId: string;
  playerId: string;
}) => Boolean(
  params.roomId
  && params.activeRoomId === params.roomId
  && params.currentUserId
  && params.currentUserId === params.playerId
);

export const shouldRestoreDeferredRoomPointer = (params: {
  hasOtherMembership: boolean;
  activeRoomId: string;
}) => !params.hasOtherMembership && !params.activeRoomId;
