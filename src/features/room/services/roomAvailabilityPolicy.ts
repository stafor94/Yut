export type RoomAvailabilityRoom = {
  status?: 'waiting' | 'playing' | 'finished';
  maxPlayers?: number;
  deletingAt?: unknown;
  systemRoomType?: string;
};

export type RoomAvailabilityPlayer = {
  id: string;
  isSpectator?: boolean;
  isAI?: boolean;
  isSubstitutedByAI?: boolean;
};

export type RoomAvailabilityReason = 'visible' | 'inactive' | 'orphaned' | 'full' | 'malformed';

export type RoomAvailabilityResult = {
  visible: boolean;
  reason: RoomAvailabilityReason;
  currentPlayers: number;
  playerIds: string[];
};

export const ROOM_CAPACITY_FULL_ERROR_MESSAGE = '방이 가득 찼습니다.';
export const ROOM_CAPACITY_FULL_EVENT = 'yut:room-capacity-full';

export const isRoomCapacityFullError = (error: unknown) => (
  error instanceof Error && error.message === ROOM_CAPACITY_FULL_ERROR_MESSAGE
);

export function classifyRoomAvailability(
  room: RoomAvailabilityRoom,
  players: RoomAvailabilityPlayer[],
  currentUserId = '',
): RoomAvailabilityResult {
  if (room.status === 'finished' || room.deletingAt || room.systemRoomType) {
    return { visible: false, reason: 'inactive', currentPlayers: 0, playerIds: [] };
  }
  if (room.status !== 'waiting' && room.status !== 'playing') return { visible: false, reason: 'malformed', currentPlayers: 0, playerIds: [] };

  const occupiedPlayers = players.filter((player) => !player.isSpectator);
  const playerIds = occupiedPlayers
    .filter((player) => (
      !player.isAI
      || (player.isSubstitutedByAI === true && Boolean(currentUserId) && player.id === currentUserId)
    ))
    .map((player) => player.id);
  const currentPlayers = occupiedPlayers.length;

  if (!playerIds.length) return { visible: false, reason: 'orphaned', currentPlayers, playerIds };

  const maxPlayers = Number(room.maxPlayers ?? 0);
  if (!Number.isInteger(maxPlayers) || maxPlayers < 2 || maxPlayers > 4) {
    return { visible: false, reason: 'malformed', currentPlayers, playerIds };
  }

  if (room.status === 'waiting' && currentPlayers >= maxPlayers && !playerIds.includes(currentUserId)) {
    return { visible: false, reason: 'full', currentPlayers, playerIds };
  }

  return { visible: true, reason: 'visible', currentPlayers, playerIds };
}
