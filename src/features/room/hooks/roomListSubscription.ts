import {
  classifyRoomAvailability,
  type RoomAvailabilityPlayer,
  type RoomAvailabilityResult,
  type RoomAvailabilityRoom,
} from '../services/roomAvailabilityPolicy';
import { ROOM_LIST_CANDIDATE_LIMIT } from '../services/roomLifecyclePolicy';

export type RoomListSummary = RoomAvailabilityRoom & {
  id: string;
  hostId?: string;
  currentPlayers?: number;
  playerIds?: string[];
};

export type RoomListPlayer = RoomAvailabilityPlayer;

export type RoomListUnsubscribe = () => void;

export type RoomListSubscriptionController = {
  start: () => void;
  stop: () => void;
  dispose: () => void;
};

type RoomListSubscriptionOptions<TRoom extends RoomListSummary, TPlayer extends RoomListPlayer> = {
  subscribeRooms: (callback: (rooms: TRoom[]) => void) => RoomListUnsubscribe;
  subscribePlayers: (roomId: string, callback: (players: TPlayer[]) => void) => RoomListUnsubscribe;
  onRooms: (rooms: TRoom[]) => void;
  getCurrentUserId?: () => string;
};

export function createRoomListSubscriptionController<TRoom extends RoomListSummary, TPlayer extends RoomListPlayer>({
  subscribeRooms,
  subscribePlayers,
  onRooms,
  getCurrentUserId = () => '',
}: RoomListSubscriptionOptions<TRoom, TPlayer>): RoomListSubscriptionController {
  let running = false;
  let unsubscribeRooms: RoomListUnsubscribe | null = null;
  let activeRooms: TRoom[] = [];
  const roomAvailability = new Map<string, RoomAvailabilityResult>();
  const roomPlayerUnsubscribes = new Map<string, RoomListUnsubscribe>();

  const publishRooms = () => {
    if (!running) return;
    const currentUserId = getCurrentUserId();
    const visibleHostIds = new Set<string>();
    const visibleRooms = activeRooms
      .map((room) => {
        const availability = roomAvailability.get(room.id);
        if (!availability?.visible) return null;
        return {
          ...room,
          currentPlayers: availability.currentPlayers,
          playerIds: availability.playerIds,
        } as TRoom;
      })
      .filter((room): room is TRoom => Boolean(room))
      .filter((room) => {
        if (currentUserId && room.playerIds?.includes(currentUserId)) return true;
        const hostId = room.hostId?.trim();
        if (!hostId) return true;
        if (visibleHostIds.has(hostId)) return false;
        visibleHostIds.add(hostId);
        return true;
      })
      .slice(0, 3);
    onRooms(visibleRooms);
  };

  const stop = () => {
    if (!running && !unsubscribeRooms && roomPlayerUnsubscribes.size === 0) return;
    running = false;
    unsubscribeRooms?.();
    unsubscribeRooms = null;
    roomPlayerUnsubscribes.forEach((unsubscribe) => unsubscribe());
    roomPlayerUnsubscribes.clear();
    activeRooms = [];
    roomAvailability.clear();
  };

  return {
    start() {
      if (running) return;
      running = true;
      unsubscribeRooms = subscribeRooms((nextRooms) => {
        if (!running) return;
        activeRooms = nextRooms.slice(0, ROOM_LIST_CANDIDATE_LIMIT);
        const activeRoomIds = new Set(activeRooms.map((room) => room.id));

        roomPlayerUnsubscribes.forEach((unsubscribe, roomId) => {
          if (activeRoomIds.has(roomId)) return;
          unsubscribe();
          roomPlayerUnsubscribes.delete(roomId);
          roomAvailability.delete(roomId);
        });

        activeRooms.forEach((room) => {
          if (roomPlayerUnsubscribes.has(room.id)) return;
          roomPlayerUnsubscribes.set(room.id, () => undefined);
          const unsubscribePlayers = subscribePlayers(room.id, (players) => {
            if (!running) return;
            const currentRoom = activeRooms.find((activeRoom) => activeRoom.id === room.id);
            if (!currentRoom) return;
            roomAvailability.set(room.id, classifyRoomAvailability(currentRoom, players, getCurrentUserId()));
            publishRooms();
          });
          if (!running || !activeRoomIds.has(room.id)) {
            unsubscribePlayers();
            roomPlayerUnsubscribes.delete(room.id);
            return;
          }
          roomPlayerUnsubscribes.set(room.id, unsubscribePlayers);
        });

        publishRooms();
      });
    },
    stop,
    dispose: stop,
  };
}
