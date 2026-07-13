import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../../../services/firebase/firebaseDb';
import {
  cleanupCurrentRoomPresence as cleanupCurrentRoomPresenceCore,
  createRoom as createRoomCore,
  deleteRoom as deleteRoomCore,
  isRoomInGame as isRoomInGameCore,
  updateRoomPlayer as updateRoomPlayerCore,
  type RoomPlayer,
  type RoomSummary,
} from './roomServiceCore';
import {
  hasNonAiPlayer,
  hasRecoverableRoomPlayer,
  isAiSubstitutionUpdate,
  shouldDeleteRoomAfterAiSubstitution,
} from './roomExitPolicy';

export * from './roomServiceCore';
export * from './roomExitPolicy';

const ACTIVE_HOST_ROOM_ERROR = '이미 진행 중인 방이 있습니다. 기존 방으로 돌아간 뒤 새 방을 만들어주세요.';

async function deleteRoomWhenNoNonAiPlayersRemain(roomId: string) {
  if (!db) return false;
  const playersSnapshot = await getDocs(collection(db, 'rooms', roomId, 'players'));
  const players = playersSnapshot.docs.map((playerDoc) => playerDoc.data() as RoomPlayer);
  if (hasNonAiPlayer(players)) return false;
  await deleteRoomCore(roomId);
  return true;
}

async function deleteOrphanedActiveHostRooms(hostId: string) {
  if (!db || !hostId) return [];
  const firestore = db;
  const roomsSnapshot = await getDocs(query(collection(firestore, 'rooms'), where('hostId', '==', hostId)));
  const activeRoomDocs = roomsSnapshot.docs.filter((roomDoc) => {
    const room = roomDoc.data() as Partial<RoomSummary>;
    return isRoomInGameCore(room as Pick<RoomSummary, 'status'> & Partial<Pick<RoomSummary, 'startStatus'>>);
  });
  const orphanRoomIds = (await Promise.all(activeRoomDocs.map(async (roomDoc) => {
    const playersSnapshot = await getDocs(collection(firestore, 'rooms', roomDoc.id, 'players'));
    const players = playersSnapshot.docs.map((playerDoc) => playerDoc.data() as RoomPlayer);
    return hasRecoverableRoomPlayer(players) ? null : roomDoc.id;
  }))).filter((roomId): roomId is string => Boolean(roomId));

  await Promise.all(orphanRoomIds.map((roomId) => deleteRoomCore(roomId)));
  return orphanRoomIds;
}

export async function createRoom(params: Parameters<typeof createRoomCore>[0]) {
  try {
    return await createRoomCore(params);
  } catch (error) {
    if (!(error instanceof Error) || error.message !== ACTIVE_HOST_ROOM_ERROR) throw error;
    const deletedRoomIds = await deleteOrphanedActiveHostRooms(params.hostId);
    if (!deletedRoomIds.length) throw error;
    return createRoomCore(params);
  }
}

export async function updateRoomPlayer(roomId: string, playerId: string, params: Partial<Omit<RoomPlayer, 'id'>>) {
  await updateRoomPlayerCore(roomId, playerId, params);
  if (!isAiSubstitutionUpdate(params)) return;

  const playersSnapshot = db ? await getDocs(collection(db, 'rooms', roomId, 'players')) : null;
  const players = playersSnapshot?.docs.map((playerDoc) => playerDoc.data() as RoomPlayer) ?? [];
  if (shouldDeleteRoomAfterAiSubstitution(params, players)) await deleteRoomCore(roomId);
}

export async function cleanupCurrentRoomPresence(...args: Parameters<typeof cleanupCurrentRoomPresenceCore>) {
  const result = await cleanupCurrentRoomPresenceCore(...args);
  if (result.cleanedPlayerIds.length) await deleteRoomWhenNoNonAiPlayersRemain(args[0]);
  return result;
}
