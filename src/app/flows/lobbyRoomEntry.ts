export type LobbyRoomEntry = {
  id: string;
  title: string;
  status: 'waiting' | 'playing' | 'finished';
};

export type RoomCodeLookup<TRoom extends LobbyRoomEntry = LobbyRoomEntry> = (roomId: string) => Promise<TRoom | null>;

export const normalizeRoomCode = (value: string) => value.trim();

export async function resolveRoomCodeEntry<TRoom extends LobbyRoomEntry>(value: string, lookupRoom: RoomCodeLookup<TRoom>): Promise<TRoom> {
  const roomId = normalizeRoomCode(value);
  if (!roomId) throw new Error('방 코드를 입력해 주세요.');

  const room = await lookupRoom(roomId);
  if (!room) throw new Error('존재하지 않는 방입니다. 방 코드를 다시 확인해 주세요.');
  if (room.status === 'finished') throw new Error('이미 종료된 방입니다.');
  return room;
}
