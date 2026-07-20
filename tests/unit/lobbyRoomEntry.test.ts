import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeRoomCode, resolveRoomCodeEntry, type LobbyRoomEntry } from '../../src/app/flows/lobbyRoomEntry';

const waitingRoom: LobbyRoomEntry = {
  id: 'room-123',
  title: '테스트방',
  status: 'waiting',
};

test('방 코드는 정규화 후 정확한 방 ID로 조회한다', async () => {
  assert.equal(normalizeRoomCode('  room-123  '), 'room-123');

  const lookedUpRoomIds: string[] = [];
  const resolved = await resolveRoomCodeEntry(' room-123 ', async (roomId) => {
    lookedUpRoomIds.push(roomId);
    return waitingRoom;
  });
  assert.equal(resolved, waitingRoom);
  assert.deepEqual(lookedUpRoomIds, ['room-123']);
});

test('비어 있거나 존재하지 않거나 종료된 방 코드는 거부한다', async () => {
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
});
