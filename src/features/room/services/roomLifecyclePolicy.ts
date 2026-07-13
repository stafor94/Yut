export type RoomLifecycleRoom = {
  status?: 'waiting' | 'playing' | 'finished';
  startStatus?: 'idle' | 'requested' | 'cancelled' | 'entering' | 'playing';
  createdAt?: unknown;
  lastActivityAt?: unknown;
  deletingAt?: unknown;
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
};

export const ROOM_MAX_IDLE_MS = 2 * 60 * 60 * 1000;
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
  !player.isSpectator && (!player.isAI || player.isSubstitutedByAI === true)
));

export const hasCreationBlockingHumanPlayer = (players: RoomLifecyclePlayer[]) => players.some((player) => (
  !player.isSpectator && !player.isAI
));

export const hasResumablePlayerForUser = (players: RoomLifecyclePlayer[], userId: string) => players.some((player) => (
  Boolean(userId)
  && player.id === userId
  && !player.isSpectator
  && (!player.isAI || player.isSubstitutedByAI === true)
));

export const hasHumanLifecyclePlayer = (players: RoomLifecyclePlayer[]) => players.some((player) => (
  !player.isSpectator && !player.isAI
));

export const getRoomLastActivityMillis = (room: RoomLifecycleRoom) => (
  getRoomTimestampMillis(room.lastActivityAt) || getRoomTimestampMillis(room.createdAt)
);

export const isRoomIdleExpired = (room: RoomLifecycleRoom, now = Date.now(), maxIdleMs = ROOM_MAX_IDLE_MS) => {
  const lastActivityAt = getRoomLastActivityMillis(room);
  return Boolean(lastActivityAt && now - lastActivityAt > maxIdleMs);
};

export const isRoomSummaryInactive = (room: RoomLifecycleRoom) => {
  if (isSystemRoom(room) || isRoomDeleting(room) || room.status === 'finished') return true;
  if (room.status !== 'waiting' && room.status !== 'playing') return true;
  return !getRoomTimestampMillis(room.createdAt);
};

export const shouldDeleteRoomSnapshot = (
  room: RoomLifecycleRoom,
  players: RoomLifecyclePlayer[],
  _now = Date.now(),
) => {
  if (isSystemRoom(room)) return false;
  if (isRoomDeleting(room) || room.status === 'finished') return true;
  if (!getRoomTimestampMillis(room.createdAt)) return true;
  if (hasRecoverableLifecyclePlayer(players)) return false;
  return true;
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
