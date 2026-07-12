export const ROOM_PLAYER_MISSING_GRACE_MS = 1500;

export function getPresenceRestoreKey(roomId: string, userId: string, seatIndex: number, presenceEpoch: number) {
  return `${roomId}:${userId}:${seatIndex}:${presenceEpoch}`;
}

export function shouldApplyPresenceRestoreResult(input: {
  requestedRoomId: string;
  currentRoomId: string;
  requestedUserId: string;
  currentUserId: string;
  requestedPresenceEpoch: number;
  restoredPresenceEpoch?: number;
  role: 'player' | 'spectator';
  screen: string;
}) {
  return input.role === 'player'
    && input.screen === 'game'
    && input.requestedRoomId === input.currentRoomId
    && input.requestedUserId === input.currentUserId
    && Number(input.restoredPresenceEpoch ?? -1) > input.requestedPresenceEpoch;
}
