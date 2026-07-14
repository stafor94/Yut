export type RoomExitPlayer = {
  isAI?: boolean;
  isSubstitutedByAI?: boolean;
  isSpectator?: boolean;
};

export type RoomExitPlayerUpdate = {
  isAI?: boolean;
  isSubstitutedByAI?: boolean;
};

export type RoomExitRoomState = {
  status?: 'waiting' | 'playing' | 'finished';
  startStatus?: 'idle' | 'requested' | 'cancelled' | 'entering' | 'playing';
};

export const isAiSubstitutionUpdate = (update: RoomExitPlayerUpdate) => (
  update.isAI === true && update.isSubstitutedByAI === true
);

export const hasNonAiPlayer = (players: RoomExitPlayer[]) => players.some((player) => (
  !player.isSpectator && !player.isAI
));

export const hasRecoverableRoomPlayer = (players: RoomExitPlayer[]) => players.some((player) => (
  !player.isSpectator && (!player.isAI || player.isSubstitutedByAI === true)
));

export const isRoomExitInGame = (room: RoomExitRoomState) => (
  room.status === 'playing' || room.startStatus === 'entering' || room.startStatus === 'playing'
);

export const shouldDeferRoomExitCleanup = (gameScreenActive: boolean, lifecycleRequestsDeferral: boolean) => (
  !gameScreenActive && lifecycleRequestsDeferral
);

export const shouldSubstituteRoomPlayerAsAi = (
  room: RoomExitRoomState,
  player: RoomExitPlayer,
  hasSeat: boolean,
) => isRoomExitInGame(room) && !player.isSpectator && hasSeat;

export function shouldDeleteRoomAfterAiSubstitution(
  update: RoomExitPlayerUpdate,
  players: RoomExitPlayer[],
) {
  return isAiSubstitutionUpdate(update) && !hasNonAiPlayer(players);
}
