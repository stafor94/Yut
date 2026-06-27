import { useEffect, useState } from 'react';
import { subscribeWaitingRooms, type RoomSummary } from '../services/roomService';

export function useRooms() {
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  useEffect(() => subscribeWaitingRooms(setRooms), []);
  return rooms;
}
