import { collection, doc, getDoc, getDocs, query, runTransaction, where } from 'firebase/firestore';
import { db } from '../../../services/firebase/firebaseDb';
import {
  deleteRoom as deleteRoomCore,
  type RoomPlayer,
  type RoomSummary,
} from './roomServiceCore';
import { hasNonAiPlayer, hasRecoverableRoomPlayer } from './roomExitPolicy';
import {
  getRoomLastActivityMillis,
  getRoomTimestampMillis,
  isSystemRoom,
  shouldDeleteRoomSnapshot,
} from './roomLifecyclePolicy';

export type ManagedRoomSummary = RoomSummary & {
  deletingAt?: unknown;
  lastActivityAt?: unknown;
  systemRoomType?: string;
  lockRequestId?: string;
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
  const roomsSnapshot = await getDocs(query(collection(db, 'rooms'), where('status', 'in', ['waiting', 'playing'])));
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
    if (guard.expectedEmptySince !== undefined && Number(room.emptySince ?? 0) !== guard.expectedEmptySince) return false;
    if (room.status === 'finished' || room.deletingAt) return true;
    const deletingAt = Date.now();
    transaction.set(roomRef, { status: 'finished', deletingAt, lastActivityAt: deletingAt }, { merge: true });
    return true;
  });
}

export async function deleteRoomSafely(roomId: string, guard: RoomDeletionGuard = {}) {
  const claimed = await claimRoomDeletion(roomId, guard);
  if (!claimed) return false;
  await deleteRoomCore(roomId);
  return true;
}

export async function deleteRoomWhenNoNonAiPlayersRemain(roomId: string) {
  if (!db) return false;
  const [room, players] = await Promise.all([getManagedRoom(roomId), getRoomPlayers(roomId)]);
  if (!room || hasNonAiPlayer(players)) return false;
  return deleteRoomSafely(roomId, {
    expectedCurrentPlayers: Number(room.currentPlayers ?? countActivePlayers(players)),
    expectedLastActivityAt: getRoomLastActivityMillis(room),
  });
}

export async function cleanupDeletionCandidatesBeforeCreate(protectedRoomId = '') {
  if (!db) return [];
  const now = Date.now();
  const roomsSnapshot = await getDocs(collection(db, 'rooms'));
  const candidates = await Promise.all(roomsSnapshot.docs.map(async (roomDoc) => {
    if (roomDoc.id === protectedRoomId) return null;
    const room = { id: roomDoc.id, ...(roomDoc.data() as Omit<ManagedRoomSummary, 'id'>) };
    if (isSystemRoom(room)) return null;
    const players = await getRoomPlayers(room.id);
    return shouldDeleteRoomSnapshot(room, players, now) ? { room, players } : null;
  }));

  const deletedRoomIds: string[] = [];
  await Promise.all(candidates.filter((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate)).map(async ({ room, players }) => {
    try {
      const deleted = await deleteRoomSafely(room.id, {
        expectedCurrentPlayers: Number(room.currentPlayers ?? countActivePlayers(players)),
        expectedLastActivityAt: getRoomLastActivityMillis(room),
      });
      if (deleted) deletedRoomIds.push(room.id);
    } catch (error) {
      console.warn('비활성 방 정리에 실패했습니다.', error);
    }
  }));
  return deletedRoomIds;
}

export async function getRecoverableActiveRooms() {
  if (!db) return [];
  const snapshot = await getDocs(query(collection(db, 'rooms'), where('status', 'in', ['waiting', 'playing'])));
  const rooms = await Promise.all(snapshot.docs.map(async (roomDoc) => {
    const room = { id: roomDoc.id, ...(roomDoc.data() as Omit<ManagedRoomSummary, 'id'>) };
    if (isSystemRoom(room) || room.deletingAt) return null;
    const players = await getRoomPlayers(room.id);
    return hasRecoverableRoomPlayer(players) ? room : null;
  }));
  return rooms.filter((room): room is ManagedRoomSummary => Boolean(room));
}
