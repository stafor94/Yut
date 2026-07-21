export type RoomCreationMembership = {
  room: {
    id: string;
  };
  player?: {
    isAI?: boolean;
    isSubstitutedByAI?: boolean;
  };
};

export type LeaveRoomBeforeCreate = (
  roomId: string,
  playerId: string,
) => Promise<unknown>;

export async function leavePlayerRoomsBeforeCreate(params: {
  playerId: string;
  memberships: RoomCreationMembership[];
  leaveRoom: LeaveRoomBeforeCreate;
}) {
  const roomIds = Array.from(new Set(
    params.memberships
      .filter(({ player }) => !(player?.isAI && player.isSubstitutedByAI))
      .map(({ room }) => room.id.trim())
      .filter(Boolean),
  ));

  await Promise.all(roomIds.map((roomId) => params.leaveRoom(roomId, params.playerId)));
  return roomIds;
}
