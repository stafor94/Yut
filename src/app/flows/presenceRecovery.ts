export type PresenceRestoreAttemptContext = {
  attempt: number;
  currentAttempt: number;
  restoreKey: string;
  currentRestoreKey: string;
  roomId: string;
  currentRoomId: string;
  userId: string;
  currentUserId: string;
};

export const getPresenceRecoveryKey = (roomId: string, userId: string, seatIndex: number, presenceVersion: number) =>
  `${roomId}:${userId}:${seatIndex}:${presenceVersion}`;

export const isPresenceRestoreAttemptCurrent = (context: PresenceRestoreAttemptContext) => (
  context.attempt === context.currentAttempt
  && context.restoreKey === context.currentRestoreKey
  && context.roomId === context.currentRoomId
  && context.userId === context.currentUserId
);
