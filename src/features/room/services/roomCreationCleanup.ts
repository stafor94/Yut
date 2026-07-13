export type RoomCreationMembership = {
  room: {
    id: string;
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
      .map(({ room }) => room.id.trim())
      .filter(Boolean),
  ));

  for (const roomId of roomIds) {
    await params.leaveRoom(roomId, params.playerId);
  }

  return roomIds;
}
