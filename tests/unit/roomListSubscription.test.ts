import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createRoomListSubscriptionController,
  type RoomListPlayer,
  type RoomListSummary,
} from '../../src/features/room/hooks/roomListSubscription.js';

type TestRoom = RoomListSummary & { title: string };
type TestPlayer = RoomListPlayer;

function createHarness() {
  let roomSubscribeCount = 0;
  let roomUnsubscribeCount = 0;
  let roomCallback: (rooms: TestRoom[]) => void = () => undefined;
  const playerSubscribeCount = new Map<string, number>();
  const playerUnsubscribeCount = new Map<string, number>();
  const playerCallbacks = new Map<string, (players: TestPlayer[]) => void>();
  const published: TestRoom[][] = [];

  const controller = createRoomListSubscriptionController<TestRoom, TestPlayer>({
    subscribeRooms(callback) {
      roomSubscribeCount += 1;
      roomCallback = callback;
      return () => { roomUnsubscribeCount += 1; };
    },
    subscribePlayers(roomId, callback) {
      playerSubscribeCount.set(roomId, (playerSubscribeCount.get(roomId) ?? 0) + 1);
      playerCallbacks.set(roomId, callback);
      return () => {
        playerUnsubscribeCount.set(roomId, (playerUnsubscribeCount.get(roomId) ?? 0) + 1);
      };
    },
    onRooms(rooms) {
      published.push(rooms);
    },
  });

  return {
    controller,
    emitRooms: (rooms: TestRoom[]) => roomCallback(rooms),
    emitPlayers: (roomId: string, players: TestPlayer[]) => playerCallbacks.get(roomId)?.(players),
    get roomSubscribeCount() { return roomSubscribeCount; },
    get roomUnsubscribeCount() { return roomUnsubscribeCount; },
    playerSubscribeCount,
    playerUnsubscribeCount,
    published,
  };
}

const getLatestPublishedRooms = (published: TestRoom[][]) => published[published.length - 1];

test('로비 controller는 start 전에는 구독하지 않고 중복 start에도 한 번만 구독한다', () => {
  const harness = createHarness();
  assert.equal(harness.roomSubscribeCount, 0);

  harness.controller.start();
  harness.controller.start();

  assert.equal(harness.roomSubscribeCount, 1);
});

test('활성 방마다 players listener를 한 번만 만들고 기존 currentPlayers 계산을 유지한다', () => {
  const harness = createHarness();
  harness.controller.start();
  harness.emitRooms([
    { id: 'room-a', title: 'A' },
    { id: 'room-b', title: 'B' },
  ]);
  harness.emitRooms([
    { id: 'room-a', title: 'A' },
    { id: 'room-b', title: 'B' },
  ]);

  assert.equal(harness.playerSubscribeCount.get('room-a'), 1);
  assert.equal(harness.playerSubscribeCount.get('room-b'), 1);

  harness.emitPlayers('room-a', [
    { id: 'human-a' },
    { id: 'spectator-a', isSpectator: true },
    { id: 'ai-a', isAI: true },
  ]);
  harness.emitPlayers('room-b', [{ id: 'human-b' }, { id: 'human-c' }]);

  const latest = getLatestPublishedRooms(harness.published) ?? [];
  assert.deepEqual(latest.map((room) => ({ id: room.id, count: room.currentPlayers, ids: room.playerIds })), [
    { id: 'room-a', count: 1, ids: ['human-a'] },
    { id: 'room-b', count: 2, ids: ['human-b', 'human-c'] },
  ]);
});

test('사람 플레이어가 없는 방은 목록에서 숨기지만 listener callback에서 삭제 작업을 만들지 않는다', () => {
  const harness = createHarness();
  harness.controller.start();
  harness.emitRooms([{ id: 'room-a', title: 'A' }]);
  harness.emitPlayers('room-a', [
    { id: 'spectator-a', isSpectator: true },
    { id: 'ai-a', isAI: true },
  ]);

  assert.deepEqual(getLatestPublishedRooms(harness.published), []);
});

test('방이 목록에서 사라지면 해당 players listener만 해제하고 늦은 callback은 무시한다', () => {
  const harness = createHarness();
  harness.controller.start();
  harness.emitRooms([
    { id: 'room-a', title: 'A' },
    { id: 'room-b', title: 'B' },
  ]);
  harness.emitPlayers('room-a', [{ id: 'human-a' }]);
  harness.emitPlayers('room-b', [{ id: 'human-b' }]);

  harness.emitRooms([{ id: 'room-b', title: 'B' }]);
  const publishCountAfterRemoval = harness.published.length;
  harness.emitPlayers('room-a', [{ id: 'late-human' }]);

  assert.equal(harness.playerUnsubscribeCount.get('room-a'), 1);
  assert.equal(harness.playerUnsubscribeCount.get('room-b') ?? 0, 0);
  assert.equal(harness.published.length, publishCountAfterRemoval);
});

test('대기실·게임 전환에 해당하는 stop은 active rooms와 모든 players listener를 즉시 해제한다', () => {
  const harness = createHarness();
  harness.controller.start();
  harness.emitRooms([
    { id: 'room-a', title: 'A' },
    { id: 'room-b', title: 'B' },
  ]);
  harness.controller.stop();
  const publishCountAfterStop = harness.published.length;

  harness.emitRooms([{ id: 'room-c', title: 'C' }]);
  harness.emitPlayers('room-a', [{ id: 'late-human' }]);

  assert.equal(harness.roomUnsubscribeCount, 1);
  assert.equal(harness.playerUnsubscribeCount.get('room-a'), 1);
  assert.equal(harness.playerUnsubscribeCount.get('room-b'), 1);
  assert.equal(harness.published.length, publishCountAfterStop);
});

test('로비 복귀에 해당하는 재시작은 즉시 새 active rooms listener를 생성한다', () => {
  const harness = createHarness();
  harness.controller.start();
  harness.emitRooms([{ id: 'room-a', title: 'A' }]);
  harness.emitPlayers('room-a', [{ id: 'human-a' }]);
  const retainedRooms = getLatestPublishedRooms(harness.published);

  harness.controller.stop();
  assert.equal(getLatestPublishedRooms(harness.published), retainedRooms);

  harness.controller.start();
  assert.equal(harness.roomSubscribeCount, 2);
});
