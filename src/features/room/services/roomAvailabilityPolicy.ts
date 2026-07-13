export type RoomAvailabilityRoom = {
  status?: 'waiting' | 'playing' | 'finished';
  maxPlayers?: number;
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

export function classifyRoomAvailability(
  room: RoomAvailabilityRoom,
  players: RoomAvailabilityPlayer[],
  currentUserId = '',
): RoomAvailabilityResult {
  if (room.status === 'finished') return { visible: false, reason: 'inactive', currentPlayers: 0, playerIds: [] };
  if (room.status !== 'waiting' && room.status !== 'playing') return { visible: false, reason: 'malformed', currentPlayers: 0, playerIds: [] };

  const activePlayers = players.filter((player) => {
    if (player.isSpectator) return false;
    if (!player.isAI) return true;
    return player.isSubstitutedByAI === true && Boolean(currentUserId) && player.id === currentUserId;
  });
  const playerIds = activePlayers.map((player) => player.id);
  const currentPlayers = activePlayers.length;

  if (!currentPlayers) return { visible: false, reason: 'orphaned', currentPlayers, playerIds };

  const maxPlayers = Number(room.maxPlayers ?? 0);
  if (!Number.isInteger(maxPlayers) || maxPlayers < 2 || maxPlayers > 4) {
    return { visible: false, reason: 'malformed', currentPlayers, playerIds };
  }

  if (room.status === 'waiting' && currentPlayers >= maxPlayers && !playerIds.includes(currentUserId)) {
    return { visible: false, reason: 'full', currentPlayers, playerIds };
  }

  return { visible: true, reason: 'visible', currentPlayers, playerIds };
}
