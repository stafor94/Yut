import {
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
  type QuerySnapshot,
  type Unsubscribe,
} from 'firebase/firestore';
import { db } from '../../../services/firebase/firebaseDb';
import { TOTAL_ROOM_LIMIT } from './roomCapacityPolicy';
import {
  ROOM_LIST_CANDIDATE_LIMIT,
  getRoomLastActivityMillis,
  isRoomSummaryInactive,
} from './roomLifecyclePolicy';
import type { RoomSummary } from './roomServiceCore';

const ROOM_LIST_QUERY_LIMIT = Math.max(ROOM_LIST_CANDIDATE_LIMIT * 2, TOTAL_ROOM_LIMIT + 1);

const roomsFromSnapshot = (snapshot: QuerySnapshot) => snapshot.docs
  .map((roomDoc) => ({ id: roomDoc.id, ...(roomDoc.data() as Omit<RoomSummary, 'id'>) }))
  .filter((room) => room.status === 'waiting' || room.status === 'playing')
  .filter((room) => !isRoomSummaryInactive(room))
  .sort((left, right) => getRoomLastActivityMillis(right) - getRoomLastActivityMillis(left))
  .slice(0, ROOM_LIST_CANDIDATE_LIMIT);

export function subscribeCappedActiveRooms(callback: (rooms: RoomSummary[]) => void): Unsubscribe {
  if (!db) {
    callback([]);
    return () => undefined;
  }

  return onSnapshot(
    query(
      collection(db, 'rooms'),
      orderBy('lastActivityAt', 'desc'),
      limit(ROOM_LIST_QUERY_LIMIT),
    ),
    (snapshot) => callback(roomsFromSnapshot(snapshot)),
    () => callback([]),
  );
}
