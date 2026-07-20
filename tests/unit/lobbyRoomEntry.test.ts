import assert from 'node:assert/strict';
import { normalizeRoomCode, resolveRoomCodeEntry, type LobbyRoomEntry } from '../../src/app/flows/lobbyRoomEntry';

const waitingRoom: LobbyRoomEntry = {
  id: 'room-123',
  title: '테스트방',
  status: 'waiting',
};

async function run() {
  assert.equal(normalizeRoomCode('  room-123  '), 'room-123');

  const lookedUpRoomIds: string[] = [];
  const resolved = await resolveRoomCodeEntry(' room-123 ', async (roomId) => {
    lookedUpRoomIds.push(roomId);
    return waitingRoom;
  });
  assert.equal(resolved, waitingRoom);
  assert.deepEqual(lookedUpRoomIds, ['room-123']);

  await assert.rejects(
    () => resolveRoomCodeEntry('   ', async () => waitingRoom),
    /방 코드를 입력해 주세요/,
  );
  await assert.rejects(
    () => resolveRoomCodeEntry('missing', async () => null),
    /존재하지 않는 방입니다/,
  );
  await assert.rejects(
    () => resolveRoomCodeEntry('finished', async () => ({ ...waitingRoom, id: 'finished', status: 'finished' })),
    /이미 종료된 방입니다/,
  );
}

void run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
