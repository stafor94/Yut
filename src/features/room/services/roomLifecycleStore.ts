import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit as firestoreLimit,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  Timestamp,
  where,
} from 'firebase/firestore';
import { db } from '../../../services/firebase/firebaseDb';
import {
  deleteRoom as deleteRoomCore,
  type RoomPlayer,
  type RoomSummary,
} from './roomServiceCore';
import { isRoomCreationCandidate } from './roomCreationPolicy';
import {
  ROOM_MAX_LIFETIME_MS,
  getRoomEmptySinceMillis,
  getRoomLastActivityMillis,
  getRoomLifetimeStartedAtMillis,
  getRoomTimestampMillis,
  hasActiveHumanLifecyclePlayer,
  isRoomDeletionExpired,
  isRoomLifetimeExpired,
  isSystemRoom,
  shouldDeleteRoomSnapshot,
  shouldStartRoomDeletionGrace,
} from './roomLifecyclePolicy';

export type ManagedRoomSummary = RoomSummary & {
  deletingAt?: unknown;
  gameStartedAt?: unknown;
  lastActivityAt?: unknown;
  lastHumanSeenAt?: unknown;
  systemRoomType?: string;
  lockRequestId?: string;
  lockOwnerToken?: string;
  lockExpiresAt?: number;
};

export type RoomDeletionGuard = {
  expectedCurrentPlayers?: number;
  expectedLastActivityAt?: number;
  expectedEmptySince?: number;
  expectedStatus?: RoomSummary['status'];
  expectedLifetimeStartedAt?: number;
};

export type PlayerRoomMembership = {
  room: ManagedRoomSummary;
  player: RoomPlayer;
  joinedAt: number;
};

const ROOM_LIFETIME_CLEANUP_LIMIT = 24;
const ROOM_DELETION_CLAIM_STALE_MS = 5 * 60 * 1000;
const roomDeletionInFlight = new Set<string>();

export const countActivePlayers = (players: RoomPlayer[]) => players.filter((player) => !player.isSpectator).length;

export async function getRoomPlayers(roomId: string) {
  if (!db) return [];
  const playersSnapshot = await getDocs(collection(db, 'rooms', roomId, 'players'));
  return playersSnapshot.docs.map((playerDoc) => ({
    id: playerDoc.id,
    ...(playerDoc.data() as Omit<RoomPlayer, 'id'>),
  }));
}

export async function getRoomPlayer(roomId: string, playerId: string): Promise<RoomPlayer | null> {
  if (!db || !roomId || !playerId) return null;
  const playerSnapshot = await getDoc(doc(db, 'rooms', roomId, 'players', playerId));
  return playerSnapshot.exists()
    ? { id: playerSnapshot.id, ...(playerSnapshot.data() as Omit<RoomPlayer, 'id'>) }
    : null;
}

export async function getManagedRoom(roomId: string): Promise<ManagedRoomSummary | null> {
  if (!db || !roomId) return null;
  const snapshot = await getDoc(doc(db, 'rooms', roomId));
  return snapshot.exists() ? { id: snapshot.id, ...(snapshot.data() as Omit<ManagedRoomSummary, 'id'>) } : null;
}

export async function getActivePlayerRoomMemberships(playerId: string): Promise<PlayerRoomMembership[]> {
  if (!db || !playerId) return [];
  const now = Date.now();
  const roomsSnapshot = await getDocs(query(collection(db, 'rooms'), where('status', 'in', ['waiting', 'playing', 'finished'])));
  const memberships = await Promise.all(roomsSnapshot.docs.map(async (roomDoc) => {
    const room = { id: roomDoc.id, ...(roomDoc.data() as Omit<ManagedRoomSummary, 'id'>) };
    if (!isRoomCreationCandidate(room, now)) return null;
    const player = await getRoomPlayer(room.id, playerId);
    if (!player) return null;
    const joinedAt = getRoomTimestampMillis(player.joinedAt)
      || getRoomTimestampMillis(player.lastSeen)
      || getRoomLastActivityMillis(room);
    return { room, player, joinedAt };
  }));
  return memberships.filter((membership): membership is PlayerRoomMembership => Boolean(membership));
}

export async function getActiveRoomSummaries(now = Date.now()) {
  if (!db) return [];
  const roomsSnapshot = await getDocs(query(collection(db, 'rooms'), where('status', 'in', ['waiting', 'playing', 'finished'])));
  return roomsSnapshot.docs
    .map((roomDoc) => ({ id: roomDoc.id, ...(roomDoc.data() as Omit<ManagedRoomSummary, 'id'>) }))
    .filter((room) => isRoomCreationCandidate(room, now));
}

async function claimRoomDeletion(roomId: string, guard: RoomDeletionGuard = {}) {
  if (!db || !roomId) return false;
  const roomRef = doc(db, 'rooms', roomId);
  return runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(roomRef);
    if (!snapshot.exists()) return false;
    const room = snapshot.data() as ManagedRoomSummary;
    if (isSystemRoom(room)) return false;
    if (guard.expectedCurrentPlayers !== undefined && Number(room.currentPlayers ?? 0) !== guard.expectedCurrentPlayers) return false;
    if (guard.expectedLastActivityAt !== undefined && getRoomLastActivityMillis(room) !== guard.expectedLastActivityAt) return false;
    if (guard.expectedEmptySince !== undefined && getRoomEmptySinceMillis(room) !== guard.expectedEmptySince) return false;
    if (guard.expectedStatus !== undefined && room.status !== guard.expectedStatus) return false;
    if (guard.expectedLifetimeStartedAt !== undefined && getRoomLifetimeStartedAtMillis(room) !== guard.expectedLifetimeStartedAt) return false;
    const deletingAt = getRoomTimestampMillis(room.deletingAt);
    if (deletingAt && Date.now() - deletingAt < ROOM_DELETION_CLAIM_STALE_MS) return false;
    transaction.set(roomRef, { status: 'finished', deletingAt: serverTimestamp(), lastActivityAt: serverTimestamp() }, { merge: true });
    return true;
  });
}

export async function deleteRoomSafely(roomId: string, guard: RoomDeletionGuard = {}) {
  if (roomDeletionInFlight.has(roomId)) return false;
  roomDeletionInFlight.add(roomId);
  try {
    const claimed = await claimRoomDeletion(roomId, guard);
    if (!claimed) return false;
    await deleteRoomCore(roomId);
    return true;
  } finally {
    roomDeletionInFlight.delete(roomId);
  }
}

async function clearRoomDeletionGrace(roomId: string, room: ManagedRoomSummary) {
  if (!db) return false;
  const expectedEmptySince = getRoomEmptySinceMillis(room);
  if (!expectedEmptySince) return false;
  const roomRef = doc(db, 'rooms', roomId);
  return runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(roomRef);
    if (!snapshot.exists()) return false;
    const currentRoom = snapshot.data() as ManagedRoomSummary;
    if (isSystemRoom(currentRoom) || currentRoom.deletingAt) return false;
    if (getRoomEmptySinceMillis(currentRoom) !== expectedEmptySince) return false;
    transaction.set(roomRef, { emptySince: null, lastActivityAt: serverTimestamp() }, { merge: true });
    return true;
  });
}

async function startRoomDeletionGrace(roomId: string, room: ManagedRoomSummary) {
  if (!db) return false;
  const expectedCurrentPlayers = Number(room.currentPlayers ?? 0);
  const expectedLastActivityAt = getRoomLastActivityMillis(room);
  const roomRef = doc(db, 'rooms', roomId);
  return runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(roomRef);
    if (!snapshot.exists()) return false;
    const currentRoom = snapshot.data() as ManagedRoomSummary;
    if (isSystemRoom(currentRoom) || currentRoom.deletingAt || getRoomEmptySinceMillis(currentRoom)) return false;
    if (Number(currentRoom.currentPlayers ?? 0) !== expectedCurrentPlayers) return false;
    if (getRoomLastActivityMillis(currentRoom) !== expectedLastActivityAt) return false;
    transaction.set(roomRef, { emptySince: serverTimestamp(), lastActivityAt: serverTimestamp() }, { merge: true });
    return true;
  });
}

export async function reconcileRoomDeletionGrace(
  roomId: string,
  now = Date.now(),
  options: { allowGraceClear?: boolean; allowGraceStart?: boolean } = {},
) {
  if (!db || !roomId) return false;
  const [room, players] = await Promise.all([getManagedRoom(roomId), getRoomPlayers(roomId)]);
  if (!room || isSystemRoom(room)) return false;

  if (!isRoomLifetimeExpired(room, now) && hasActiveHumanLifecyclePlayer(players, now)) {
    if (options.allowGraceClear) await clearRoomDeletionGrace(roomId, room);
    return false;
  }

  if (shouldDeleteRoomSnapshot(room, players, now)) {
    return deleteRoomSafely(roomId, {
      expectedCurrentPlayers: Number(room.currentPlayers ?? countActivePlayers(players)),
      expectedLastActivityAt: getRoomLastActivityMillis(room),
      expectedEmptySince: getRoomEmptySinceMillis(room) || undefined,
      expectedStatus: room.status,
      expectedLifetimeStartedAt: getRoomLifetimeStartedAtMillis(room) || undefined,
    });
  }

  if (options.allowGraceStart && shouldStartRoomDeletionGrace(room, players, now)) {
    await startRoomDeletionGrace(roomId, room);
  }
  return false;
}

export async function deleteRoomWhenNoNonAiPlayersRemain(roomId: string) {
  return reconcileRoomDeletionGrace(roomId, Date.now(), { allowGraceStart: true });
}

export async function cleanupExpiredRoomLifetimes(protectedRoomId = '') {
  if (!db) return [];
  const now = Date.now();
  const cutoff = Timestamp.fromMillis(now - ROOM_MAX_LIFETIME_MS);
  const roomsSnapshot = await getDocs(query(
    collection(db, 'rooms'),
    where('createdAt', '<=', cutoff),
    orderBy('createdAt', 'asc'),
    firestoreLimit(ROOM_LIFETIME_CLEANUP_LIMIT),
  ));
  const candidates = roomsSnapshot.docs
    .map((roomDoc) => ({ id: roomDoc.id, ...(roomDoc.data() as Omit<ManagedRoomSummary, 'id'>) }))
    .filter((room) => room.id !== protectedRoomId)
    .filter((room) => isRoomLifetimeExpired(room, now));

  const deletedRoomIds: string[] = [];
  await Promise.all(candidates.map(async (room) => {
    try {
      const deleted = await deleteRoomSafely(room.id, {
        expectedStatus: room.status,
        expectedLifetimeStartedAt: getRoomLifetimeStartedAtMillis(room) || undefined,
      });
      if (deleted) deletedRoomIds.push(room.id);
    } catch (error) {
      console.warn('1시간 만료 방 정리에 실패했습니다.', room.id, error);
    }
  }));
  return deletedRoomIds;
}

export async function cleanupDeletionCandidatesBeforeCreate(protectedRoomId = '') {
  if (!db) return [];
  const roomsSnapshot = await getDocs(collection(db, 'rooms'));
  const deletedRoomIds: string[] = [];
  await Promise.all(roomsSnapshot.docs.map(async (roomDoc) => {
    if (roomDoc.id === protectedRoomId) return;
    const room = { id: roomDoc.id, ...(roomDoc.data() as Omit<ManagedRoomSummary, 'id'>) };
    if (isSystemRoom(room)) return;
    try {
      const deleted = await reconcileRoomDeletionGrace(room.id);
      if (deleted) deletedRoomIds.push(room.id);
    } catch (error) {
      console.warn('비활성 방 정리에 실패했습니다.', error);
    }
  }));
  return deletedRoomIds;
}

export async function getActiveRoomsWithPlayers() {
  if (!db) return [];
  const now = Date.now();
  const snapshot = await getDocs(query(collection(db, 'rooms'), where('status', 'in', ['waiting', 'playing', 'finished'])));
  const rooms = await Promise.all(snapshot.docs.map(async (roomDoc) => {
    const room = { id: roomDoc.id, ...(roomDoc.data() as Omit<ManagedRoomSummary, 'id'>) };
    if (isSystemRoom(room) || room.deletingAt || isRoomLifetimeExpired(room, now)) return null;
    const players = await getRoomPlayers(room.id);
    if (isRoomDeletionExpired(room, now) && !hasActiveHumanLifecyclePlayer(players, now)) return null;
    return { room, players };
  }));
  return rooms.filter((entry): entry is { room: ManagedRoomSummary; players: RoomPlayer[] } => Boolean(entry));
}
