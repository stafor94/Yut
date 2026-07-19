import { collection, doc, getDoc, getDocs, query, runTransaction, serverTimestamp, where } from 'firebase/firestore';
import { db } from '../../../services/firebase/firebaseDb';
import {
  deleteRoom as deleteRoomCore,
  type RoomPlayer,
  type RoomSummary,
} from './roomServiceCore';
import {
  getRoomEmptySinceMillis,
  getRoomLastActivityMillis,
  getRoomTimestampMillis,
  hasActiveHumanLifecyclePlayer,
  isRoomDeletionExpired,
  isSystemRoom,
  shouldDeleteRoomSnapshot,
  shouldStartRoomDeletionGrace,
} from './roomLifecyclePolicy';

export type ManagedRoomSummary = RoomSummary & {
  deletingAt?: unknown;
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
};

export type PlayerRoomMembership = {
  room: ManagedRoomSummary;
  player: RoomPlayer;
  joinedAt: number;
};

export const countActivePlayers = (players: RoomPlayer[]) => players.filter((player) => !player.isSpectator).length;

export async function getRoomPlayers(roomId: string) {
  if (!db) return [];
  const playersSnapshot = await getDocs(collection(db, 'rooms', roomId, 'players'));
  return playersSnapshot.docs.map((playerDoc) => ({
    id: playerDoc.id,
    ...(playerDoc.data() as Omit<RoomPlayer, 'id'>),
  }));
}

export async function getManagedRoom(roomId: string): Promise<ManagedRoomSummary | null> {
  if (!db || !roomId) return null;
  const snapshot = await getDoc(doc(db, 'rooms', roomId));
  return snapshot.exists() ? { id: snapshot.id, ...(snapshot.data() as Omit<ManagedRoomSummary, 'id'>) } : null;
}

export async function getActivePlayerRoomMemberships(playerId: string): Promise<PlayerRoomMembership[]> {
  if (!db || !playerId) return [];
  const roomsSnapshot = await getDocs(query(collection(db, 'rooms'), where('status', 'in', ['waiting', 'playing', 'finished'])));
  const memberships = await Promise.all(roomsSnapshot.docs.map(async (roomDoc) => {
    const room = { id: roomDoc.id, ...(roomDoc.data() as Omit<ManagedRoomSummary, 'id'>) };
    if (isSystemRoom(room) || room.deletingAt) return null;
    const playerSnapshot = await getDoc(doc(db!, 'rooms', room.id, 'players', playerId));
    if (!playerSnapshot.exists()) return null;
    const player = { id: playerSnapshot.id, ...(playerSnapshot.data() as Omit<RoomPlayer, 'id'>) };
    const joinedAt = getRoomTimestampMillis(player.joinedAt)
      || getRoomTimestampMillis(player.lastSeen)
      || getRoomLastActivityMillis(room);
    return { room, player, joinedAt };
  }));
  return memberships.filter((membership): membership is PlayerRoomMembership => Boolean(membership));
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
    if (room.status === 'finished' || room.deletingAt) return true;
    transaction.set(roomRef, { status: 'finished', deletingAt: serverTimestamp(), lastActivityAt: serverTimestamp() }, { merge: true });
    return true;
  });
}

export async function deleteRoomSafely(roomId: string, guard: RoomDeletionGuard = {}) {
  const claimed = await claimRoomDeletion(roomId, guard);
  if (!claimed) return false;
  await deleteRoomCore(roomId);
  return true;
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

  if (hasActiveHumanLifecyclePlayer(players, now)) {
    if (options.allowGraceClear) await clearRoomDeletionGrace(roomId, room);
    return false;
  }

  if (shouldDeleteRoomSnapshot(room, players, now)) {
    return deleteRoomSafely(roomId, {
      expectedCurrentPlayers: Number(room.currentPlayers ?? countActivePlayers(players)),
      expectedLastActivityAt: getRoomLastActivityMillis(room),
      expectedEmptySince: getRoomEmptySinceMillis(room) || undefined,
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
    if (isSystemRoom(room) || room.deletingAt) return null;
    const players = await getRoomPlayers(room.id);
    if (isRoomDeletionExpired(room, now) && !hasActiveHumanLifecyclePlayer(players, now)) return null;
    return { room, players };
  }));
  return rooms.filter((entry): entry is { room: ManagedRoomSummary; players: RoomPlayer[] } => Boolean(entry));
}
