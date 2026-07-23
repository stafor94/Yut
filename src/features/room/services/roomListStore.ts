import {
  collection,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  type QuerySnapshot,
  type Unsubscribe,
} from 'firebase/firestore';
import { db } from '../../../services/firebase/firebaseDb';
import {
  LEGACY_ROOM_SCAN_LIMIT,
  TOTAL_ROOM_LIMIT,
} from './roomCapacityPolicy';
import {
  ROOM_LIST_CANDIDATE_LIMIT,
  getRoomLastActivityMillis,
  isRoomSummaryInactive,
} from './roomLifecyclePolicy';
import type { RoomSummary } from './roomServiceCore';

const ROOM_LIST_QUERY_LIMIT = Math.max(ROOM_LIST_CANDIDATE_LIMIT * 2, TOTAL_ROOM_LIMIT + 1);

type RoomListSnapshot = Pick<QuerySnapshot, 'docs'>;

const roomsFromSnapshots = (...snapshots: RoomListSnapshot[]) => {
  const roomsById = new Map<string, RoomSummary>();
  snapshots.forEach((snapshot) => snapshot.docs.forEach((roomDoc) => {
    roomsById.set(roomDoc.id, { id: roomDoc.id, ...(roomDoc.data() as Omit<RoomSummary, 'id'>) });
  }));
  return [...roomsById.values()]
    .filter((room) => room.status === 'waiting' || room.status === 'playing')
    .filter((room) => !isRoomSummaryInactive(room))
    .sort((left, right) => getRoomLastActivityMillis(right) - getRoomLastActivityMillis(left))
    .slice(0, ROOM_LIST_CANDIDATE_LIMIT);
};

export function subscribeCappedActiveRooms(callback: (rooms: RoomSummary[]) => void): Unsubscribe {
  if (!db) {
    callback([]);
    return () => undefined;
  }

  let active = true;
  let activitySnapshot: RoomListSnapshot = { docs: [] };
  let legacySnapshot: RoomListSnapshot = { docs: [] };
  const emitRooms = () => {
    if (active) callback(roomsFromSnapshots(activitySnapshot, legacySnapshot));
  };

  void getDocs(query(
    collection(db, 'rooms'),
    orderBy('createdAt', 'desc'),
    limit(LEGACY_ROOM_SCAN_LIMIT),
  )).then((snapshot) => {
    legacySnapshot = snapshot;
    emitRooms();
  }).catch(() => undefined);

  const unsubscribe = onSnapshot(
    query(
      collection(db, 'rooms'),
      orderBy('lastActivityAt', 'desc'),
      limit(ROOM_LIST_QUERY_LIMIT),
    ),
    (snapshot) => {
      activitySnapshot = snapshot;
      emitRooms();
    },
    () => callback([]),
  );

  return () => {
    active = false;
    unsubscribe();
  };
}
