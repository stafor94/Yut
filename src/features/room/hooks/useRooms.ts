import { useEffect, useState } from 'react';
import { subscribeActiveRooms, subscribeRoomPlayers, type RoomSummary } from '../services/roomService';

export function useRooms() {
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  useEffect(() => {
    let activeRooms: RoomSummary[] = [];
    const playerCounts = new Map<string, number>();
    const roomPlayerUnsubscribes = new Map<string, () => void>();

    const publishRooms = () => {
      setRooms(activeRooms.map((room) => ({ ...room, currentPlayers: playerCounts.get(room.id) ?? room.currentPlayers ?? 0 })));
    };

    const unsubscribeRooms = subscribeActiveRooms((nextRooms) => {
      activeRooms = nextRooms;
      const activeRoomIds = new Set(nextRooms.map((room) => room.id));

      roomPlayerUnsubscribes.forEach((unsubscribe, roomId) => {
        if (!activeRoomIds.has(roomId)) {
          unsubscribe();
          roomPlayerUnsubscribes.delete(roomId);
          playerCounts.delete(roomId);
        }
      });

      nextRooms.forEach((room) => {
        if (roomPlayerUnsubscribes.has(room.id)) return;
        roomPlayerUnsubscribes.set(room.id, subscribeRoomPlayers(room.id, (players) => {
          playerCounts.set(room.id, players.filter((player) => !player.isSpectator).length);
          publishRooms();
        }));
      });

      publishRooms();
    });

    return () => {
      unsubscribeRooms();
      roomPlayerUnsubscribes.forEach((unsubscribe) => unsubscribe());
    };
  }, []);
  return rooms;
}
