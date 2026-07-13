export type RoomExitPlayer = {
  isAI?: boolean;
  isSpectator?: boolean;
};

export type RoomExitPlayerUpdate = {
  isAI?: boolean;
  isSubstitutedByAI?: boolean;
};

export const isAiSubstitutionUpdate = (update: RoomExitPlayerUpdate) => (
  update.isAI === true && update.isSubstitutedByAI === true
);

export const hasNonAiPlayer = (players: RoomExitPlayer[]) => players.some((player) => (
  !player.isSpectator && !player.isAI
));

export function shouldDeleteRoomAfterAiSubstitution(
  update: RoomExitPlayerUpdate,
  players: RoomExitPlayer[],
) {
  return isAiSubstitutionUpdate(update) && !hasNonAiPlayer(players);
}
