import type { RoomPlayer } from '../../features/room/services/roomServiceCore';

type RoomHostPresence = Pick<RoomPlayer, 'isAI' | 'isSubstitutedByAI' | 'isSpectator'>;

export function isActiveHumanRoomHost(player: RoomHostPresence | null | undefined) {
  return Boolean(player && !player.isAI && !player.isSubstitutedByAI && !player.isSpectator);
}
