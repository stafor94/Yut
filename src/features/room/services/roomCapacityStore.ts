import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit as firestoreLimit,
  orderBy,
  query,
  where,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { db } from '../../../services/firebase/firebaseDb';
import { isRoomCreationCandidate } from './roomCreationPolicy';
import {
  getRoomLastActivityMillis,
  getRoomTimestampMillis,
} from './roomLifecyclePolicy';
import {
  LEGACY_ROOM_SCAN_LIMIT,
  QA_ROOM_LIMIT,
  TOTAL_ROOM_LIMIT,
  USER_ROOM_LIMIT,
  classifyRoomKind,
  type RoomKind,
} from './roomCapacityPolicy';
import type { RoomPlayer, RoomSummary } from './roomServiceCore';

export type CapacityRoomSummary = RoomSummary & {
  roomKind?: RoomKind;
  titleKey?: string;
  isQaRoom?: boolean;
  qaRunId?: string;
  qaRole?: string;
  qaCreatedAt?: unknown;
  deletingAt?: unknown;
  lastActivityAt?: unknown;
  lastHumanSeenAt?: unknown;
  systemRoomType?: string;
};

export type CapacityPlayerRoomMembership = {
  room: CapacityRoomSummary;
  player: RoomPlayer;
  joinedAt: number;
};

const roomFromSnapshot = (snapshot: QueryDocumentSnapshot) => ({
  id: snapshot.id,
  ...(snapshot.data() as Omit<CapacityRoomSummary, 'id'>),
});

const uniqueRooms = (rooms: CapacityRoomSummary[]) => {
  const byId = new Map<string, CapacityRoomSummary>();
  rooms.forEach((room) => byId.set(room.id, room));
  return [...byId.values()];
};

const getRecentLegacyRoomDocuments = async () => {
  if (!db) return [];
  const snapshot = await getDocs(query(
    collection(db, 'rooms'),
    orderBy('lastActivityAt', 'desc'),
    firestoreLimit(LEGACY_ROOM_SCAN_LIMIT),
  ));
  return snapshot.docs
    .map(roomFromSnapshot)
    .filter((room) => room.roomKind !== 'user' && room.roomKind !== 'qa');
};

export async function getRoomDocumentsByKind(roomKind: RoomKind, now = Date.now()) {
  if (!db) return [];
  const roomLimit = roomKind === 'qa' ? QA_ROOM_LIMIT : USER_ROOM_LIMIT;
  const [kindSnapshot, legacyRooms] = await Promise.all([
    getDocs(query(
      collection(db, 'rooms'),
      where('roomKind', '==', roomKind),
      firestoreLimit(roomLimit + 1),
    )),
    getRecentLegacyRoomDocuments(),
  ]);
  const explicitRooms = kindSnapshot.docs.map(roomFromSnapshot);
  const matchingLegacyRooms = legacyRooms
    .filter((room) => isRoomCreationCandidate(room, now))
    .filter((room) => classifyRoomKind(room) === roomKind);
  return uniqueRooms([...explicitRooms, ...matchingLegacyRooms]);
}

export async function getActiveHostRoomSummaries(hostId: string, now = Date.now()) {
  if (!db || !hostId) return [];
  const snapshot = await getDocs(query(
    collection(db, 'rooms'),
    where('hostId', '==', hostId),
    firestoreLimit(TOTAL_ROOM_LIMIT + LEGACY_ROOM_SCAN_LIMIT),
  ));
  return snapshot.docs
    .map(roomFromSnapshot)
    .filter((room) => isRoomCreationCandidate(room, now));
}

export async function getDuplicateRoomTitleSummaries(title: string, titleKey: string, now = Date.now()) {
  if (!db || !titleKey) return [];
  const [keySnapshot, legacyTitleSnapshot] = await Promise.all([
    getDocs(query(collection(db, 'rooms'), where('titleKey', '==', titleKey), firestoreLimit(2))),
    getDocs(query(collection(db, 'rooms'), where('title', '==', title), firestoreLimit(2))),
  ]);
  return uniqueRooms([
    ...keySnapshot.docs.map(roomFromSnapshot),
    ...legacyTitleSnapshot.docs.map(roomFromSnapshot),
  ]).filter((room) => isRoomCreationCandidate(room, now));
}

export async function getCappedActivePlayerRoomMemberships(playerId: string): Promise<CapacityPlayerRoomMembership[]> {
  if (!db || !playerId) return [];
  const now = Date.now();
  const [userRoomsSnapshot, qaRoomsSnapshot, legacyRooms] = await Promise.all([
    getDocs(query(collection(db, 'rooms'), where('roomKind', '==', 'user'), firestoreLimit(USER_ROOM_LIMIT))),
    getDocs(query(collection(db, 'rooms'), where('roomKind', '==', 'qa'), firestoreLimit(QA_ROOM_LIMIT))),
    getRecentLegacyRoomDocuments(),
  ]);
  const candidateRooms = uniqueRooms([
    ...userRoomsSnapshot.docs.map(roomFromSnapshot),
    ...qaRoomsSnapshot.docs.map(roomFromSnapshot),
    ...legacyRooms,
  ]).filter((room) => isRoomCreationCandidate(room, now));

  const memberships = await Promise.all(candidateRooms.map(async (room) => {
    const playerSnapshot = await getDoc(doc(db!, 'rooms', room.id, 'players', playerId));
    if (!playerSnapshot.exists()) return null;
    const player = {
      id: playerSnapshot.id,
      ...(playerSnapshot.data() as Omit<RoomPlayer, 'id'>),
    };
    const joinedAt = getRoomTimestampMillis(player.joinedAt)
      || getRoomTimestampMillis(player.lastSeen)
      || getRoomLastActivityMillis(room);
    return { room, player, joinedAt };
  }));

  return memberships.filter((membership): membership is CapacityPlayerRoomMembership => Boolean(membership));
}
