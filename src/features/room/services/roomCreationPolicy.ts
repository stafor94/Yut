import { ROOM_PRESENCE_STALE_MS } from './roomPresenceCleanupPolicy';
import {
  getRoomEmptySinceMillis,
  getRoomLastHumanSeenMillis,
  isRoomDeletionExpired,
  isRoomLifetimeExpired,
  isRoomSummaryInactive,
  type RoomLifecycleRoom,
} from './roomLifecyclePolicy';

export const isRoomCreationCandidate = (
  room: RoomLifecycleRoom,
  now = Date.now(),
) => !isRoomSummaryInactive(room) && !isRoomDeletionExpired(room, now) && !isRoomLifetimeExpired(room, now);

export const hasActiveHumanRoomSummary = (
  room: RoomLifecycleRoom,
  now = Date.now(),
  staleMs = ROOM_PRESENCE_STALE_MS,
) => {
  if (!isRoomCreationCandidate(room, now) || getRoomEmptySinceMillis(room)) return false;
  const lastHumanSeenAt = getRoomLastHumanSeenMillis(room);
  if (lastHumanSeenAt) return now - lastHumanSeenAt <= staleMs;
  return Number(room.currentPlayers ?? 0) > 0;
};
