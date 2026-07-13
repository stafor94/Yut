import { collection, getDocs } from 'firebase/firestore';
import { db } from '../../../services/firebase/firebaseDb';
import {
  cleanupCurrentRoomPresence as cleanupCurrentRoomPresenceCore,
  deleteRoom as deleteRoomCore,
  updateRoomPlayer as updateRoomPlayerCore,
  type RoomPlayer,
} from './roomServiceCore';
import {
  hasNonAiPlayer,
  isAiSubstitutionUpdate,
  shouldDeleteRoomAfterAiSubstitution,
} from './roomExitPolicy';

export * from './roomServiceCore';
export * from './roomExitPolicy';

async function deleteRoomWhenNoNonAiPlayersRemain(roomId: string) {
  if (!db) return false;
  const playersSnapshot = await getDocs(collection(db, 'rooms', roomId, 'players'));
  const players = playersSnapshot.docs.map((playerDoc) => playerDoc.data() as RoomPlayer);
  if (hasNonAiPlayer(players)) return false;
  await deleteRoomCore(roomId);
  return true;
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
