type RoomHostPresence = {
  isAI?: boolean;
  isSubstitutedByAI?: boolean;
  isSpectator?: boolean;
};

export function isActiveHumanRoomHost(player: RoomHostPresence | null | undefined) {
  return Boolean(player && !player.isAI && !player.isSubstitutedByAI && !player.isSpectator);
}
