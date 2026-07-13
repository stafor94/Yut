export type RoomListSummary = {
  id: string;
  currentPlayers?: number;
  playerIds?: string[];
};

export type RoomListPlayer = {
  id: string;
  isSpectator?: boolean;
  isAI?: boolean;
  isSubstitutedByAI?: boolean;
};

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
};

export function createRoomListSubscriptionController<TRoom extends RoomListSummary, TPlayer extends RoomListPlayer>({
  subscribeRooms,
  subscribePlayers,
  onRooms,
}: RoomListSubscriptionOptions<TRoom, TPlayer>): RoomListSubscriptionController {
  let running = false;
  let unsubscribeRooms: RoomListUnsubscribe | null = null;
  let activeRooms: TRoom[] = [];
  const playerCounts = new Map<string, number>();
  const roomPlayerIds = new Map<string, string[]>();
  const roomPlayerUnsubscribes = new Map<string, RoomListUnsubscribe>();

  const publishRooms = () => {
    if (!running) return;
    const visibleRooms = activeRooms
      .filter((room) => playerCounts.has(room.id))
      .map((room) => ({
        ...room,
        currentPlayers: playerCounts.get(room.id) ?? 0,
        playerIds: roomPlayerIds.get(room.id) ?? [],
      }))
      .filter((room) => Number(room.currentPlayers ?? 0) > 0) as TRoom[];
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
    playerCounts.clear();
    roomPlayerIds.clear();
  };

  return {
    start() {
      if (running) return;
      running = true;
      unsubscribeRooms = subscribeRooms((nextRooms) => {
        if (!running) return;
        activeRooms = nextRooms;
        const activeRoomIds = new Set(nextRooms.map((room) => room.id));

        roomPlayerUnsubscribes.forEach((unsubscribe, roomId) => {
          if (activeRoomIds.has(roomId)) return;
          unsubscribe();
          roomPlayerUnsubscribes.delete(roomId);
          playerCounts.delete(roomId);
          roomPlayerIds.delete(roomId);
        });

        nextRooms.forEach((room) => {
          if (roomPlayerUnsubscribes.has(room.id)) return;
          roomPlayerUnsubscribes.set(room.id, () => undefined);
          const unsubscribePlayers = subscribePlayers(room.id, (players) => {
            if (!running || !activeRooms.some((activeRoom) => activeRoom.id === room.id)) return;
            const activePlayers = players.filter((player) => !player.isSpectator && (!player.isAI || player.isSubstitutedByAI));
            playerCounts.set(room.id, activePlayers.length);
            roomPlayerIds.set(room.id, activePlayers.map((player) => player.id));
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
