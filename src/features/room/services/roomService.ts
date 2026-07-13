import {
  deleteRoom as deleteRoomCore,
  getRoom as getRoomCore,
  removeRoomPlayer as removeRoomPlayerCore,
  updateRoomPlayer as updateRoomPlayerCore,
  type RoomPlayer,
} from './roomServiceCore';
import { shouldDeleteHostedRoomOnGameExit, type HostGameExitTrigger } from './roomExitPolicy';

export * from './roomServiceCore';
export * from './roomExitPolicy';

async function deleteHostedRoomOnGameExit(roomId: string, playerId: string, trigger: HostGameExitTrigger) {
  const room = await getRoomCore(roomId);
  if (!shouldDeleteHostedRoomOnGameExit(room, playerId, trigger)) return false;
  await deleteRoomCore(roomId);
  return true;
}

export async function updateRoomPlayer(roomId: string, playerId: string, params: Partial<Omit<RoomPlayer, 'id'>>) {
  const isExplicitGameExitSubstitution = params.isAI === true && params.isSubstitutedByAI === true;
  if (isExplicitGameExitSubstitution && await deleteHostedRoomOnGameExit(roomId, playerId, 'ai_substitution')) return;
  await updateRoomPlayerCore(roomId, playerId, params);
}

export async function removeRoomPlayer(roomId: string, playerId: string, options: { preservePlayingSeatAsAi?: boolean } = {}) {
  const isExplicitFinishedGameExit = options.preservePlayingSeatAsAi === false;
  if (isExplicitFinishedGameExit && await deleteHostedRoomOnGameExit(roomId, playerId, 'player_removal')) return;
  await removeRoomPlayerCore(roomId, playerId, options);
}
