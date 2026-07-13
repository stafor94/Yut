export type RoomExitPolicyRoom = {
  hostId?: string;
  status?: 'waiting' | 'playing' | 'finished';
  startStatus?: 'idle' | 'requested' | 'cancelled' | 'entering' | 'playing';
};

export type HostGameExitTrigger = 'ai_substitution' | 'player_removal';

const isStartedGameRoom = (room: RoomExitPolicyRoom) => room.status === 'playing'
  || room.status === 'finished'
  || room.startStatus === 'entering'
  || room.startStatus === 'playing';

export function shouldDeleteHostedRoomOnGameExit(
  room: RoomExitPolicyRoom | null,
  playerId: string,
  trigger: HostGameExitTrigger,
) {
  return Boolean(
    room
    && playerId
    && room.hostId === playerId
    && isStartedGameRoom(room)
    && (trigger === 'ai_substitution' || trigger === 'player_removal'),
  );
}
