import { collection, getDocs } from 'firebase/firestore';
import { db } from '../../../services/firebase/firebaseDb';
import {
  deleteRoom as deleteRoomCore,
  updateRoomPlayer as updateRoomPlayerCore,
  type RoomPlayer,
} from './roomServiceCore';
import { isAiSubstitutionUpdate, shouldDeleteRoomAfterAiSubstitution } from './roomExitPolicy';

export * from './roomServiceCore';
export * from './roomExitPolicy';

async function deleteRoomWhenOnlyAiPlayersRemain(
  roomId: string,
  update: Partial<Omit<RoomPlayer, 'id'>>,
) {
  if (!db || !isAiSubstitutionUpdate(update)) return;
  const playersSnapshot = await getDocs(collection(db, 'rooms', roomId, 'players'));
  const players = playersSnapshot.docs.map((playerDoc) => playerDoc.data() as RoomPlayer);
  if (shouldDeleteRoomAfterAiSubstitution(update, players)) await deleteRoomCore(roomId);
}

export async function updateRoomPlayer(roomId: string, playerId: string, params: Partial<Omit<RoomPlayer, 'id'>>) {
  await updateRoomPlayerCore(roomId, playerId, params);
  await deleteRoomWhenOnlyAiPlayersRemain(roomId, params);
}
