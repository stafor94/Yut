import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildPreparedRoomGameState,
  getGameStartCoordinatorPlayerId,
  getRoomStartPreparationAt,
  getRoomStartPreparationMutationId,
  getRoomStartRequestKey,
  ROOM_START_CANCEL_LOCK_MS,
  type GameStartPreparationPlayer,
  type GameStartPreparationRoom,
} from '../../src/app/flows/gameStartPreparation.js';
import {
  isRoomGameActivationWindowOpen,
  isRoomGamePreparationWindowOpen,
  ROOM_START_ACTIVATION_GRACE_MS,
} from '../../src/features/room/services/roomGamePreparationPolicy.js';
import { TURN_ACTION_TIMEOUT_MS } from '../../src/features/room/services/roomTiming.js';
import { TURN_ORDER_PRESENTATION_PREPARE_MS, getTurnOrderSlotRevealDurationMs } from '../../src/app/flows/turnOrderPresentation.js';

const room: GameStartPreparationRoom = {
  id: 'room-sync',
  hostId: 'player-1',
  maxPlayers: 3,
  itemMode: false,
  playMode: 'individual',
  pieceCount: 2,
};

const players: GameStartPreparationPlayer[] = [
  { id: 'player-1', nickname: '하나', color: 'red', seatIndex: 0, team: '청팀' },
  { id: 'player-2', nickname: '둘', color: 'blue', seatIndex: 1, team: '청팀' },
  { id: 'player-3', nickname: '셋', color: 'green', seatIndex: 2, team: '청팀' },
];

test('취소 잠금 시점은 카운트다운 종료 2초 전으로 계산한다', () => {
  const countdownEndsAt = 20_000;
  assert.equal(ROOM_START_CANCEL_LOCK_MS, 2_000);
  assert.equal(getRoomStartPreparationAt(countdownEndsAt), 18_000);
});

test('초기 게임 상태는 취소 잠금 이후부터 카운트다운 종료 전까지만 준비한다', () => {
  const countdownEndsAt = 20_000;
  assert.equal(isRoomGamePreparationWindowOpen(countdownEndsAt, 17_999), false);
  assert.equal(isRoomGamePreparationWindowOpen(countdownEndsAt, 18_000), true);
  assert.equal(isRoomGamePreparationWindowOpen(countdownEndsAt, 19_999), true);
  assert.equal(isRoomGamePreparationWindowOpen(countdownEndsAt, 20_000), false);
  assert.equal(isRoomGamePreparationWindowOpen(countdownEndsAt, 29_000), false);
});

test('준비된 게임은 카운트다운 종료 직후 5초 유예시간 안에서만 활성화한다', () => {
  const countdownEndsAt = 20_000;
  assert.equal(ROOM_START_ACTIVATION_GRACE_MS, 5_000);
  assert.equal(isRoomGameActivationWindowOpen(countdownEndsAt, 19_999), false);
  assert.equal(isRoomGameActivationWindowOpen(countdownEndsAt, 20_000), true);
  assert.equal(isRoomGameActivationWindowOpen(countdownEndsAt, 25_000), true);
  assert.equal(isRoomGameActivationWindowOpen(countdownEndsAt, 25_001), false);
  assert.equal(isRoomGameActivationWindowOpen(countdownEndsAt, 29_000), false);
});

test('같은 시작 요청은 동일한 준비 키와 mutation id를 사용한다', () => {
  assert.equal(getRoomStartRequestKey('room-sync', 4, 'request-a'), 'room-sync:4:request-a');
  assert.equal(getRoomStartPreparationMutationId('room-sync', 4, 'request-a'), 'game_initialized:room-sync:4:request-a');
  assert.equal(getRoomStartRequestKey('', 4, 'request-a'), '');
});

test('첫 번째 인간 좌석이 게임 시작 준비 coordinator가 된다', () => {
  const coordinatorPlayers: GameStartPreparationPlayer[] = [
    { id: 'ai-1', nickname: 'AI', color: 'red', seatIndex: 0, team: '청팀', isAI: true },
    { id: 'human-2', nickname: '둘', color: 'green', seatIndex: 2, team: '청팀' },
    { id: 'spectator', nickname: '관전', color: 'yellow', seatIndex: 3, team: '청팀', isSpectator: true },
    { id: 'human-1', nickname: '하나', color: 'blue', seatIndex: 1, team: '청팀' },
  ];
  assert.equal(getGameStartCoordinatorPlayerId(coordinatorPlayers), 'human-1');
});

test('준비 상태의 순서 연출은 카운트다운 종료 시각부터 시작한다', () => {
  const countdownEndsAt = 100_000;
  const state = buildPreparedRoomGameState({
    roomId: room.id,
    room,
    players,
    startRequestVersion: 7,
    startRequestId: 'request-7',
    countdownEndsAt,
  });
  const expectedSlotUntil = countdownEndsAt + TURN_ORDER_PRESENTATION_PREPARE_MS + getTurnOrderSlotRevealDurationMs(players.length);

  assert.equal(state.turnOrderIntro.slotUntil, expectedSlotUntil);
  assert.equal(state.gameStartedAt, expectedSlotUntil + 2_000);
  assert.equal(state.turnDeadlineAt, state.gameStartedAt + TURN_ACTION_TIMEOUT_MS);
  assert.deepEqual(state.turnOrderIds, state.initialTurnOrderIds);
  assert.equal(state.turnOrderIds.length, players.length);
  assert.equal(state.pieces.length, players.length * room.pieceCount);
  assert.equal(state.startRequestVersion, 7);
  assert.equal(state.startRequestId, 'request-7');
});

test('같은 방과 시작 버전으로 생성한 준비 상태는 결정론적이다', () => {
  const params = {
    roomId: room.id,
    room,
    players,
    startRequestVersion: 9,
    startRequestId: 'request-9',
    countdownEndsAt: 200_000,
  };
  assert.deepEqual(buildPreparedRoomGameState(params), buildPreparedRoomGameState(params));
});
