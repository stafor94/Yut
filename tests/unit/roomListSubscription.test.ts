import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createRoomListSubscriptionController,
  type RoomListPlayer,
  type RoomListSummary,
} from '../../src/features/room/hooks/roomListSubscription.js';
import { ROOM_LIST_CANDIDATE_LIMIT } from '../../src/features/room/services/roomLifecyclePolicy.js';

type TestRoom = RoomListSummary & { title: string };
type TestPlayer = RoomListPlayer;

function createHarness(currentUserId = 'viewer') {
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
    getCurrentUserId: () => currentUserId,
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

const waitingRoom = (id: string, title: string, maxPlayers = 4): TestRoom => ({ id, title, status: 'waiting', maxPlayers });
const playingRoom = (id: string, title: string, maxPlayers = 4): TestRoom => ({ id, title, status: 'playing', maxPlayers });
const expiredPlayingRoom = (id: string, title: string, maxPlayers = 4): TestRoom => ({
  ...playingRoom(id, title, maxPlayers),
  emptySince: 1,
});
const getLatestPublishedRooms = (published: TestRoom[][]) => published[published.length - 1];

test('로비 controller는 start 전에는 구독하지 않고 중복 start에도 한 번만 구독한다', () => {
  const harness = createHarness();
  assert.equal(harness.roomSubscribeCount, 0);
  harness.controller.start();
  harness.controller.start();
  assert.equal(harness.roomSubscribeCount, 1);
});

test('활성 방마다 players listener를 한 번만 만들고 사람과 AI 좌석 인원을 집계한다', () => {
  const harness = createHarness();
  harness.controller.start();
  harness.emitRooms([waitingRoom('room-a', 'A'), waitingRoom('room-b', 'B')]);
  harness.emitRooms([waitingRoom('room-a', 'A'), waitingRoom('room-b', 'B')]);
  assert.equal(harness.playerSubscribeCount.get('room-a'), 1);
  assert.equal(harness.playerSubscribeCount.get('room-b'), 1);
  harness.emitPlayers('room-a', [{ id: 'human-a' }, { id: 'spectator-a', isSpectator: true }, { id: 'ai-a', isAI: true }]);
  harness.emitPlayers('room-b', [{ id: 'human-b' }, { id: 'human-c' }]);
  const latest = getLatestPublishedRooms(harness.published) ?? [];
  assert.deepEqual(latest.map((room) => ({ id: room.id, count: room.currentPlayers, ids: room.playerIds })), [
    { id: 'room-a', count: 2, ids: ['human-a'] },
    { id: 'room-b', count: 2, ids: ['human-b', 'human-c'] },
  ]);
});

test('현재 사용자의 AI 대체 자리만 남은 진행 방은 복귀를 위해 목록에 유지한다', () => {
  const harness = createHarness('viewer');
  harness.controller.start();
  harness.emitRooms([playingRoom('room-a', 'A')]);
  harness.emitPlayers('room-a', [{ id: 'viewer', isAI: true, isSubstitutedByAI: true }, { id: 'regular-ai', isAI: true }, { id: 'spectator-a', isSpectator: true }]);
  assert.deepEqual(getLatestPublishedRooms(harness.published), [{ id: 'room-a', title: 'A', status: 'playing', maxPlayers: 4, currentPlayers: 2, playerIds: ['viewer'] }]);
});

test('같은 방장의 새 방이 있어도 현재 사용자의 AI 대체 진행 방은 함께 표시한다', () => {
  const harness = createHarness('viewer');
  harness.controller.start();
  harness.emitRooms([
    { ...waitingRoom('room-new', '새 방'), hostId: 'viewer' },
    { ...playingRoom('room-old', '복귀 방'), hostId: 'viewer' },
  ]);
  harness.emitPlayers('room-new', [{ id: 'viewer' }]);
  harness.emitPlayers('room-old', [{ id: 'viewer', isAI: true, isSubstitutedByAI: true }, { id: 'regular-ai', isAI: true }]);
  assert.deepEqual((getLatestPublishedRooms(harness.published) ?? []).map((room) => room.id), ['room-new', 'room-old']);
});

test('표시 상한 앞에 다른 방 3개가 있어도 현재 사용자의 복귀 방을 우선 표시한다', () => {
  const harness = createHarness('viewer');
  harness.controller.start();
  harness.emitRooms([
    waitingRoom('room-a', 'A'),
    waitingRoom('room-b', 'B'),
    waitingRoom('room-c', 'C'),
    playingRoom('room-resume', '복귀 방'),
  ]);
  harness.emitPlayers('room-a', [{ id: 'human-a' }]);
  harness.emitPlayers('room-b', [{ id: 'human-b' }]);
  harness.emitPlayers('room-c', [{ id: 'human-c' }]);
  harness.emitPlayers('room-resume', [
    { id: 'viewer', isAI: true, isSubstitutedByAI: true },
    { id: 'regular-ai', isAI: true },
  ]);
  assert.deepEqual((getLatestPublishedRooms(harness.published) ?? []).map((room) => room.id), ['room-resume', 'room-a', 'room-b']);
});

test('현재 사용자 방 뒤의 같은 방장 비복귀 중복 방은 숨긴다', () => {
  const harness = createHarness('viewer');
  harness.controller.start();
  harness.emitRooms([
    { ...waitingRoom('room-new', '새 방'), hostId: 'viewer' },
    { ...playingRoom('room-old', '이전 방'), hostId: 'viewer' },
  ]);
  harness.emitPlayers('room-new', [{ id: 'viewer' }]);
  harness.emitPlayers('room-old', [{ id: 'human-old' }]);
  assert.deepEqual((getLatestPublishedRooms(harness.published) ?? []).map((room) => room.id), ['room-new']);
});

test('3분 유예가 만료된 다른 사용자의 AI 대체 방은 목록에서 숨긴다', () => {
  const harness = createHarness('viewer');
  harness.controller.start();
  harness.emitRooms([expiredPlayingRoom('room-a', 'A')]);
  harness.emitPlayers('room-a', [{ id: 'departed-user', isAI: true, isSubstitutedByAI: true }, { id: 'ai-a', isAI: true }]);
  assert.deepEqual(getLatestPublishedRooms(harness.published), []);
});

test('가득 찬 대기 방은 기존 참가자가 아닌 사용자에게 숨긴다', () => {
  const harness = createHarness('viewer');
  harness.controller.start();
  harness.emitRooms([waitingRoom('room-a', 'A', 2)]);
  harness.emitPlayers('room-a', [{ id: 'human-a' }, { id: 'human-b' }]);
  assert.deepEqual(getLatestPublishedRooms(harness.published), []);
});

test('가득 찬 대기 방이라도 현재 사용자가 기존 참가자면 목록에 유지한다', () => {
  const harness = createHarness('human-a');
  harness.controller.start();
  harness.emitRooms([waitingRoom('room-a', 'A', 2)]);
  harness.emitPlayers('room-a', [{ id: 'human-a' }, { id: 'human-b' }]);
  assert.equal(getLatestPublishedRooms(harness.published)?.length, 1);
});

test('방이 목록에서 사라지면 해당 players listener만 해제하고 늦은 callback은 무시한다', () => {
  const harness = createHarness();
  harness.controller.start();
  harness.emitRooms([waitingRoom('room-a', 'A'), waitingRoom('room-b', 'B')]);
  harness.emitPlayers('room-a', [{ id: 'human-a' }]);
  harness.emitPlayers('room-b', [{ id: 'human-b' }]);
  harness.emitRooms([waitingRoom('room-b', 'B')]);
  const publishCountAfterRemoval = harness.published.length;
  harness.emitPlayers('room-a', [{ id: 'late-human' }]);
  assert.equal(harness.playerUnsubscribeCount.get('room-a'), 1);
  assert.equal(harness.playerUnsubscribeCount.get('room-b') ?? 0, 0);
  assert.equal(harness.published.length, publishCountAfterRemoval);
});

test('대기실·게임 전환에 해당하는 stop은 active rooms와 모든 players listener를 즉시 해제한다', () => {
  const harness = createHarness();
  harness.controller.start();
  harness.emitRooms([waitingRoom('room-a', 'A'), waitingRoom('room-b', 'B')]);
  harness.controller.stop();
  const publishCountAfterStop = harness.published.length;
  harness.emitRooms([waitingRoom('room-c', 'C')]);
  harness.emitPlayers('room-a', [{ id: 'late-human' }]);
  assert.equal(harness.roomUnsubscribeCount, 1);
  assert.equal(harness.playerUnsubscribeCount.get('room-a'), 1);
  assert.equal(harness.playerUnsubscribeCount.get('room-b'), 1);
  assert.equal(harness.published.length, publishCountAfterStop);
});

test('로비 복귀에 해당하는 재시작은 즉시 새 active rooms listener를 생성한다', () => {
  const harness = createHarness();
  harness.controller.start();
  harness.emitRooms([waitingRoom('room-a', 'A')]);
  harness.emitPlayers('room-a', [{ id: 'human-a' }]);
  const retainedRooms = getLatestPublishedRooms(harness.published);
  harness.controller.stop();
  assert.equal(getLatestPublishedRooms(harness.published), retainedRooms);
  harness.controller.start();
  assert.equal(harness.roomSubscribeCount, 2);
});

test('앞쪽의 만료된 AI 전용 방을 제외하고 정상 방 최대 3개를 표시한다', () => {
  const harness = createHarness('viewer');
  harness.controller.start();
  harness.emitRooms([expiredPlayingRoom('orphan', '만료 방'), waitingRoom('room-a', 'A'), waitingRoom('room-b', 'B'), waitingRoom('room-c', 'C'), waitingRoom('room-d', 'D')]);
  harness.emitPlayers('orphan', [{ id: 'other', isAI: true, isSubstitutedByAI: true }]);
  harness.emitPlayers('room-a', [{ id: 'human-a' }]);
  harness.emitPlayers('room-b', [{ id: 'human-b' }]);
  harness.emitPlayers('room-c', [{ id: 'human-c' }]);
  harness.emitPlayers('room-d', [{ id: 'human-d' }]);
  assert.deepEqual((getLatestPublishedRooms(harness.published) ?? []).map((room) => room.id), ['room-a', 'room-b', 'room-c']);
});

test('방이 비정상적으로 많아도 players listener는 후보 상한까지만 생성한다', () => {
  const harness = createHarness();
  harness.controller.start();
  harness.emitRooms(Array.from({ length: ROOM_LIST_CANDIDATE_LIMIT + 5 }, (_, index) => waitingRoom(`room-${index}`, `방 ${index}`)));
  assert.equal(harness.playerSubscribeCount.size, ROOM_LIST_CANDIDATE_LIMIT);
  assert.equal(harness.playerSubscribeCount.has(`room-${ROOM_LIST_CANDIDATE_LIMIT}`), false);
});
