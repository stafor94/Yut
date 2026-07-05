import { useEffect, useState } from 'react';
import { deleteRoom, subscribeActiveRooms, subscribeRoomPlayers, type RoomSummary } from '../services/roomService';

export function useRooms() {
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  useEffect(() => {
    let activeRooms: RoomSummary[] = [];
    const playerCounts = new Map<string, number>();
    const roomPlayerIds = new Map<string, string[]>();
    const roomPlayerUnsubscribes = new Map<string, () => void>();

    const publishRooms = () => {
      const visibleRooms = activeRooms
        .filter((room) => playerCounts.has(room.id))
        .map((room) => ({ ...room, currentPlayers: playerCounts.get(room.id) ?? 0, playerIds: roomPlayerIds.get(room.id) ?? [] }))
        .filter((room) => room.currentPlayers > 0);
      setRooms(visibleRooms);
    };

    const unsubscribeRooms = subscribeActiveRooms((nextRooms) => {
      activeRooms = nextRooms;
      const activeRoomIds = new Set(nextRooms.map((room) => room.id));

      roomPlayerUnsubscribes.forEach((unsubscribe, roomId) => {
        if (!activeRoomIds.has(roomId)) {
          unsubscribe();
          roomPlayerUnsubscribes.delete(roomId);
          playerCounts.delete(roomId);
          roomPlayerIds.delete(roomId);
        }
      });

      nextRooms.forEach((room) => {
        if (roomPlayerUnsubscribes.has(room.id)) return;
        roomPlayerUnsubscribes.set(room.id, subscribeRoomPlayers(room.id, (players) => {
          const activePlayers = players.filter((player) => !player.isSpectator && !player.isAI);
          if (activePlayers.length === 0) {
            void deleteRoom(room.id).catch((error) => console.warn('빈 방 정리에 실패했습니다.', error));
          }
          playerCounts.set(room.id, activePlayers.length);
          roomPlayerIds.set(room.id, activePlayers.map((player) => player.id));
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
