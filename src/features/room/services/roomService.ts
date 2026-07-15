import {
  collection,
  doc,
  onSnapshot,
  query,
  setDoc,
  where,
  writeBatch,
  type Unsubscribe,
} from 'firebase/firestore';
import { db } from '../../../services/firebase/firebaseDb';
import { waitForGamePresentationBeforeAction } from '../../../shared/gamePresentationLock';
import {
  cleanupCurrentRoomPresence as cleanupCurrentRoomPresenceCore,
  commitAuthoritativeGameAction as commitAuthoritativeGameActionCore,
  createRoom as createRoomCore,
  getProcessedGameAction as getProcessedGameActionCore,
  joinRoom as joinRoomCore,
  removeRoomPlayer as removeRoomPlayerCore,
  updateRoomPlayer as updateRoomPlayerCore,
  updateRoomStatus as updateRoomStatusCore,
  type CommitAuthoritativeGameActionResult,
  type GameAction,
  type JoinRoomResult,
  type RoomPlayer,
  type RoomSummary,
} from './roomServiceCore';
import { settleAuthoritativeCommit } from './authoritativeCommitTimeout';
import { isAiSubstitutionUpdate } from './roomExitPolicy';
import { ROOM_LIST_CANDIDATE_LIMIT, getRoomLastActivityMillis, isRoomSummaryInactive } from './roomLifecyclePolicy';
import {
  cleanupDeletionCandidatesBeforeCreate,
  countActivePlayers,
  deleteRoomSafely,
  deleteRoomWhenNoNonAiPlayersRemain,
  getManagedRoom,
  getRoomPlayers,
  type ManagedRoomSummary,
  type RoomDeletionGuard,
} from './roomLifecycleStore';
import { createRoomSafely } from './roomCreationService';
import { joinRoomSafely } from './roomJoinService';
import {
  drainPendingRoomCleanups,
  leaveDuplicatePlayerRoomsSafely,
  queuePendingRoomCleanup,
  removeRoomPlayerSafely,
} from './roomExitService';

export * from './roomServiceCore';
export * from './roomExitPolicy';
export * from './roomAvailabilityPolicy';
export * from './roomLifecyclePolicy';

const keepNewestRoomPerHost = (rooms: RoomSummary[]) => {
  const latestRoomsByHost = new Map<string, RoomSummary>();
  const roomsWithoutHost: RoomSummary[] = [];
  rooms.forEach((room) => {
    if (!room.hostId) {
      roomsWithoutHost.push(room);
      return;
    }
    const currentRoom = latestRoomsByHost.get(room.hostId);
    if (!currentRoom || getRoomLastActivityMillis(room) > getRoomLastActivityMillis(currentRoom)) latestRoomsByHost.set(room.hostId, room);
  });
  return [...latestRoomsByHost.values(), ...roomsWithoutHost]
    .sort((left, right) => getRoomLastActivityMillis(right) - getRoomLastActivityMillis(left));
};

export function subscribeActiveRooms(callback: (rooms: RoomSummary[]) => void): Unsubscribe {
  if (!db) { callback([]); return () => undefined; }
  void drainPendingRoomCleanups();
  const roomsQuery = query(collection(db, 'rooms'), where('status', 'in', ['waiting', 'playing']));
  return onSnapshot(roomsQuery, (snapshot) => {
    const rooms = snapshot.docs
      .map((roomDoc) => ({ id: roomDoc.id, ...(roomDoc.data() as Omit<RoomSummary, 'id'>) }))
      .filter((room) => !isRoomSummaryInactive(room as ManagedRoomSummary));
    callback(keepNewestRoomPerHost(rooms).slice(0, ROOM_LIST_CANDIDATE_LIMIT));
  }, () => callback([]));
}

export async function commitAuthoritativeGameAction(
  roomId: string,
  action: Omit<GameAction, 'id' | 'createdAt' | 'processed'>,
): Promise<CommitAuthoritativeGameActionResult> {
  await waitForGamePresentationBeforeAction(action.type);
  const clientActionId = typeof action.payload?.clientActionId === 'string' ? action.payload.clientActionId : '';
  const result = await settleAuthoritativeCommit({
    actionType: action.type,
    commit: () => commitAuthoritativeGameActionCore(roomId, action),
    recoverProcessed: clientActionId ? () => getProcessedGameActionCore(roomId, clientActionId) : undefined,
  });
  if (db && (result.status === 'committed' || result.status === 'duplicate')) {
    void setDoc(doc(db, 'rooms', roomId), { lastActivityAt: Date.now() }, { merge: true }).catch(() => undefined);
  }
  return result;
}

export async function createRoom(params: Parameters<typeof createRoomCore>[0]) {
  return createRoomSafely(params);
}

export async function joinRoom(...args: Parameters<typeof joinRoomCore>): Promise<JoinRoomResult> {
  const [roomId, params] = args;
  const result = await joinRoomSafely(...args);
  void leaveDuplicatePlayerRoomsSafely(params.userId, roomId).catch((error) => console.warn('입장 후 중복 방 정리에 실패했습니다.', error));
  return result;
}

export async function removeRoomPlayer(...args: Parameters<typeof removeRoomPlayerCore>) {
  return removeRoomPlayerSafely(...args);
}

export async function leaveDuplicatePlayerRooms(playerId: string, keepRoomId = '') {
  return leaveDuplicatePlayerRoomsSafely(playerId, keepRoomId);
}

export async function deleteRoom(roomId: string, guard: RoomDeletionGuard = {}) {
  return deleteRoomSafely(roomId, guard);
}

export async function updateRoomPlayer(roomId: string, playerId: string, params: Partial<Omit<RoomPlayer, 'id'>>) {
  try {
    await updateRoomPlayerCore(roomId, playerId, params);
  } catch (error) {
    if (isAiSubstitutionUpdate(params)) queuePendingRoomCleanup({ roomId, playerId, preservePlayingSeatAsAi: true });
    throw error;
  }
  if (db) await setDoc(doc(db, 'rooms', roomId), { lastActivityAt: Date.now() }, { merge: true });
  if (!isAiSubstitutionUpdate(params)) return;
  await deleteRoomWhenNoNonAiPlayersRemain(roomId);
}

export async function updateRoomStatus(roomId: string, status: RoomSummary['status']) {
  await updateRoomStatusCore(roomId, status);
  if (db) await setDoc(doc(db, 'rooms', roomId), {
    lastActivityAt: Date.now(),
    ...(status !== 'finished' ? { deletingAt: null } : {}),
  }, { merge: true });
}

export async function cleanupCurrentRoomPresence(...args: Parameters<typeof cleanupCurrentRoomPresenceCore>) {
  const [roomId] = args;
  const [roomBefore, playersBefore] = await Promise.all([getManagedRoom(roomId), getRoomPlayers(roomId)]);
  const seatIndexByPlayerId = new Map(playersBefore.map((player) => [player.id, Number(player.seatIndex)]));
  const result = await cleanupCurrentRoomPresenceCore(...args);
  if (!result.cleanedPlayerIds.length) return result;

  if (db && roomBefore?.status === 'waiting') {
    const batch = writeBatch(db);
    result.cleanedPlayerIds.forEach((playerId) => {
      const seatIndex = seatIndexByPlayerId.get(playerId);
      if (Number.isInteger(seatIndex) && Number(seatIndex) >= 0) batch.delete(doc(db!, 'rooms', roomId, 'seats', String(seatIndex)));
    });
    const playersAfter = await getRoomPlayers(roomId);
    batch.set(doc(db, 'rooms', roomId), {
      currentPlayers: countActivePlayers(playersAfter),
      lastActivityAt: Date.now(),
    }, { merge: true });
    await batch.commit();
  }

  await deleteRoomWhenNoNonAiPlayersRemain(roomId);
  return result;
}

export async function cleanupInactiveRooms(protectedRoomId = '') {
  return cleanupDeletionCandidatesBeforeCreate(protectedRoomId);
}

export async function scheduleEmptyRoomDeletion(roomId: string) {
  if (!db || !roomId) return;
  const players = await getRoomPlayers(roomId);
  const roomRef = doc(db, 'rooms', roomId);
  if (players.length) {
    await setDoc(roomRef, { currentPlayers: countActivePlayers(players), emptySince: null, lastActivityAt: Date.now() }, { merge: true });
    return;
  }
  const emptySince = Date.now();
  await setDoc(roomRef, { currentPlayers: 0, emptySince, lastActivityAt: emptySince }, { merge: true });
  globalThis.setTimeout(() => {
    void (async () => {
      const [room, currentPlayers] = await Promise.all([getManagedRoom(roomId), getRoomPlayers(roomId)]);
      if (!room || currentPlayers.length || Number(room.emptySince ?? 0) !== emptySince) return;
      await deleteRoomSafely(roomId, { expectedCurrentPlayers: 0, expectedEmptySince: emptySince, expectedLastActivityAt: emptySince });
    })().catch((error) => console.warn('빈 방 지연 정리에 실패했습니다.', error));
  }, 30_000);
}
