import { useEffect, useState } from 'react';
import { subscribeActiveRooms, type RoomSummary } from '../services/roomService';

export function useRooms() {
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  useEffect(() => subscribeActiveRooms(setRooms), []);
  return rooms;
}
