import {
  collection,
  limit,
  onSnapshot,
  query,
  where,
  type QuerySnapshot,
  type Unsubscribe,
} from 'firebase/firestore';
import { db } from '../../../services/firebase/firebaseDb';
import {
  ROOM_LIST_CANDIDATE_LIMIT,
  getRoomLastActivityMillis,
  isRoomSummaryInactive,
} from './roomLifecyclePolicy';
import type { RoomSummary } from './roomServiceCore';

type RoomBucket = 'waiting' | 'playing';

type RoomListState = Record<RoomBucket, RoomSummary[]>;
type RoomListReadyState = Record<RoomBucket, boolean>;

const roomsFromSnapshot = (snapshot: QuerySnapshot) => snapshot.docs
  .map((roomDoc) => ({ id: roomDoc.id, ...(roomDoc.data() as Omit<RoomSummary, 'id'>) }))
  .filter((room) => !isRoomSummaryInactive(room));

const mergeRooms = (state: RoomListState) => {
  const rooms = new Map<string, RoomSummary>();
  [...state.waiting, ...state.playing].forEach((room) => rooms.set(room.id, room));
  return [...rooms.values()]
    .sort((left, right) => getRoomLastActivityMillis(right) - getRoomLastActivityMillis(left))
    .slice(0, ROOM_LIST_CANDIDATE_LIMIT);
};

export function subscribeCappedActiveRooms(callback: (rooms: RoomSummary[]) => void): Unsubscribe {
  if (!db) {
    callback([]);
    return () => undefined;
  }

  const state: RoomListState = { waiting: [], playing: [] };
  const ready: RoomListReadyState = { waiting: false, playing: false };
  let active = true;

  const publish = () => {
    if (!active || !ready.waiting || !ready.playing) return;
    callback(mergeRooms(state));
  };

  const subscribeBucket = (status: RoomBucket) => onSnapshot(
    query(
      collection(db!, 'rooms'),
      where('status', '==', status),
      limit(ROOM_LIST_CANDIDATE_LIMIT),
    ),
    (snapshot) => {
      state[status] = roomsFromSnapshot(snapshot);
      ready[status] = true;
      publish();
    },
    () => {
      state[status] = [];
      ready[status] = true;
      publish();
    },
  );

  const unsubscribeWaiting = subscribeBucket('waiting');
  const unsubscribePlaying = subscribeBucket('playing');

  return () => {
    active = false;
    unsubscribeWaiting();
    unsubscribePlaying();
  };
}
