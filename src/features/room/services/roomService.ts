import { collection, getDocs, onSnapshot, query, where, type Unsubscribe } from 'firebase/firestore';
import { db } from '../../../services/firebase/firebaseDb';
import {
  cleanupCurrentRoomPresence as cleanupCurrentRoomPresenceCore,
  commitAuthoritativeGameAction as commitAuthoritativeGameActionCore,
  createRoom as createRoomCore,
  deleteRoom as deleteRoomCore,
  getProcessedGameAction as getProcessedGameActionCore,
  isRoomInGame as isRoomInGameCore,
  removeRoomPlayer as removeRoomPlayerCore,
  updateRoomPlayer as updateRoomPlayerCore,
  type CommitAuthoritativeGameActionResult,
  type GameAction,
  type RoomPlayer,
  type RoomSummary,
} from './roomServiceCore';
import { settleAuthoritativeCommit } from './authoritativeCommitTimeout';
import {
  hasNonAiPlayer,
  hasRecoverableRoomPlayer,
  isAiSubstitutionUpdate,
  shouldDeleteRoomAfterAiSubstitution,
} from './roomExitPolicy';

export * from './roomServiceCore';
export * from './roomExitPolicy';
export * from './roomAvailabilityPolicy';

const ACTIVE_HOST_ROOM_ERROR = '이미 진행 중인 방이 있습니다. 기존 방으로 돌아간 뒤 새 방을 만들어주세요.';
const ACTIVE_ROOM_LIMIT_ERROR = '방은 최대 3개까지만 만들 수 있습니다. 기존 방에 참여하거나 잠시 뒤 다시 시도해주세요.';
const DUPLICATE_ROOM_TITLE_ERROR = '이미 존재하는 방 제목입니다. 다른 제목을 입력해주세요.';
const ROOM_MAX_AGE_MS = 2 * 60 * 60 * 1000;

const getCreatedAtMillis = (createdAt: unknown) => {
  if (createdAt && typeof createdAt === 'object' && 'toMillis' in createdAt && typeof createdAt.toMillis === 'function') {
    return Number(createdAt.toMillis());
  }
  if (createdAt instanceof Date) return createdAt.getTime();
  if (typeof createdAt === 'number') return createdAt;
  return 0;
};

const isRetryableCreateRoomError = (error: unknown) => error instanceof Error && [
  ACTIVE_HOST_ROOM_ERROR,
  ACTIVE_ROOM_LIMIT_ERROR,
  DUPLICATE_ROOM_TITLE_ERROR,
].includes(error.message);

const isInactiveRoomSummary = (room: Partial<RoomSummary>, now = Date.now()) => {
  const createdAt = getCreatedAtMillis(room.createdAt);
  const expired = Boolean(createdAt && now - createdAt > ROOM_MAX_AGE_MS);
  const emptyGhost = room.currentPlayers !== undefined && Number(room.currentPlayers) <= 0;
  return room.status === 'finished' || !createdAt || expired || emptyGhost;
};

const keepNewestRoomPerHost = (rooms: RoomSummary[]) => {
  const latestRoomsByHost = new Map<string, RoomSummary>();
  const roomsWithoutHost: RoomSummary[] = [];
  rooms.forEach((room) => {
    if (!room.hostId) {
      roomsWithoutHost.push(room);
      return;
    }
    const currentRoom = latestRoomsByHost.get(room.hostId);
    if (!currentRoom || getCreatedAtMillis(room.createdAt) > getCreatedAtMillis(currentRoom.createdAt)) latestRoomsByHost.set(room.hostId, room);
  });
  return [...latestRoomsByHost.values(), ...roomsWithoutHost]
    .sort((left, right) => getCreatedAtMillis(right.createdAt) - getCreatedAtMillis(left.createdAt));
};

export function subscribeActiveRooms(callback: (rooms: RoomSummary[]) => void): Unsubscribe {
  if (!db) { callback([]); return () => undefined; }
  const roomsQuery = query(collection(db, 'rooms'), where('status', 'in', ['waiting', 'playing']));
  return onSnapshot(roomsQuery, (snapshot) => {
    const now = Date.now();
    const rooms = snapshot.docs
      .map((roomDoc) => ({ id: roomDoc.id, ...(roomDoc.data() as Omit<RoomSummary, 'id'>) }))
      .filter((room) => !isInactiveRoomSummary(room, now));
    callback(keepNewestRoomPerHost(rooms));
  }, () => callback([]));
}

export async function commitAuthoritativeGameAction(
  roomId: string,
  action: Omit<GameAction, 'id' | 'createdAt' | 'processed'>,
): Promise<CommitAuthoritativeGameActionResult> {
  const clientActionId = typeof action.payload?.clientActionId === 'string' ? action.payload.clientActionId : '';
  return settleAuthoritativeCommit({
    actionType: action.type,
    commit: () => commitAuthoritativeGameActionCore(roomId, action),
    recoverProcessed: clientActionId ? () => getProcessedGameActionCore(roomId, clientActionId) : undefined,
  });
}

async function getRoomPlayers(roomId: string) {
  if (!db) return [];
  const playersSnapshot = await getDocs(collection(db, 'rooms', roomId, 'players'));
  return playersSnapshot.docs.map((playerDoc) => ({
    id: playerDoc.id,
    ...(playerDoc.data() as Omit<RoomPlayer, 'id'>),
  }));
}

async function deleteRoomWhenNoNonAiPlayersRemain(roomId: string) {
  if (!db) return false;
  const players = await getRoomPlayers(roomId);
  if (hasNonAiPlayer(players)) return false;
  await deleteRoomCore(roomId);
  return true;
}

async function cleanupDeletionCandidatesBeforeCreate() {
  if (!db) return [];
  const now = Date.now();
  const roomsSnapshot = await getDocs(collection(db, 'rooms'));
  const deletionCandidates = (await Promise.all(roomsSnapshot.docs.map(async (roomDoc) => {
    const room = roomDoc.data() as Partial<RoomSummary>;
    const createdAt = getCreatedAtMillis(room.createdAt);
    const expired = Boolean(createdAt && now - createdAt > ROOM_MAX_AGE_MS);
    const inactive = room.status === 'finished'
      || !createdAt
      || expired
      || (room.currentPlayers !== undefined && Number(room.currentPlayers) <= 0);
    if (inactive) return roomDoc.id;
    if (room.status !== 'waiting' && !isRoomInGameCore(room as Pick<RoomSummary, 'status'> & Partial<Pick<RoomSummary, 'startStatus'>>)) return null;
    const players = await getRoomPlayers(roomDoc.id);
    return hasRecoverableRoomPlayer(players) ? null : roomDoc.id;
  }))).filter((roomId): roomId is string => Boolean(roomId));

  const uniqueRoomIds = Array.from(new Set(deletionCandidates));
  await Promise.all(uniqueRoomIds.map((roomId) => deleteRoomCore(roomId)));
  return uniqueRoomIds;
}

export async function createRoom(params: Parameters<typeof createRoomCore>[0]) {
  try {
    return await createRoomCore(params);
  } catch (error) {
    if (!isRetryableCreateRoomError(error)) throw error;
    const deletedRoomIds = await cleanupDeletionCandidatesBeforeCreate();
    if (!deletedRoomIds.length) throw error;
    return createRoomCore(params);
  }
}

export async function removeRoomPlayer(...args: Parameters<typeof removeRoomPlayerCore>) {
  await removeRoomPlayerCore(...args);
  await deleteRoomWhenNoNonAiPlayersRemain(args[0]);
}

export async function updateRoomPlayer(roomId: string, playerId: string, params: Partial<Omit<RoomPlayer, 'id'>>) {
  await updateRoomPlayerCore(roomId, playerId, params);
  if (!isAiSubstitutionUpdate(params)) return;

  const players = await getRoomPlayers(roomId);
  if (shouldDeleteRoomAfterAiSubstitution(params, players)) await deleteRoomCore(roomId);
}

export async function cleanupCurrentRoomPresence(...args: Parameters<typeof cleanupCurrentRoomPresenceCore>) {
  const result = await cleanupCurrentRoomPresenceCore(...args);
  if (result.cleanedPlayerIds.length) await deleteRoomWhenNoNonAiPlayersRemain(args[0]);
  return result;
}
