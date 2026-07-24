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
  ROOM_START_ACTIVATION_LEAD_MS,
} from '../../src/features/room/services/roomGamePreparationPolicy.js';
import {
  TURN_ORDER_INITIAL_DELAY_MS,
  TURN_ORDER_ROUND_DURATION_MS,
} from '../../src/app/flows/turnOrderFlow.js';

const room: GameStartPreparationRoom = {
  id: 'room-sync',
  hostId: 'player-1',
  maxPlayers: 3,
  itemMode: false,
  stackedRollMode: true,
  playMode: 'individual',
  pieceCount: 2,
  startRequestedAt: 95_000,
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
});

test('준비된 게임은 종료 750ms 전부터 종료 후 5초까지 활성화할 수 있다', () => {
  const countdownEndsAt = 20_000;
  assert.equal(ROOM_START_ACTIVATION_LEAD_MS, 750);
  assert.equal(ROOM_START_ACTIVATION_GRACE_MS, 5_000);
  assert.equal(isRoomGameActivationWindowOpen(countdownEndsAt, 19_249), false);
  assert.equal(isRoomGameActivationWindowOpen(countdownEndsAt, 19_250), true);
  assert.equal(isRoomGameActivationWindowOpen(countdownEndsAt, 20_000), true);
  assert.equal(isRoomGameActivationWindowOpen(countdownEndsAt, 25_000), true);
  assert.equal(isRoomGameActivationWindowOpen(countdownEndsAt, 25_001), false);
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

test('순서 정하기는 게임 시작 요청 시각 8초 뒤에 시작하고 실제 턴은 아직 열지 않는다', () => {
  const countdownEndsAt = 100_000;
  const state = buildPreparedRoomGameState({
    roomId: room.id,
    room,
    players,
    startRequestVersion: 7,
    startRequestId: 'request-7',
    countdownEndsAt,
  });
  const expectedStartAt = Math.max(countdownEndsAt, Number(room.startRequestedAt) + TURN_ORDER_INITIAL_DELAY_MS);

  assert.equal(state.turnOrderIntro.currentRound.startAt, expectedStartAt);
  assert.equal(state.turnOrderIntro.currentRound.deadlineAt, expectedStartAt + TURN_ORDER_ROUND_DURATION_MS);
  assert.deepEqual(state.turnOrderIntro.currentRound.eligibleSeatIds, players.map((player) => player.id));
  assert.deepEqual(state.turnOrderIds, []);
  assert.deepEqual(state.initialTurnOrderIds, []);
  assert.equal(state.gameStartedAt, null);
  assert.equal(state.turnDeadlineAt, 0);
  assert.equal(state.turnDeadlineKind, '');
  assert.equal(state.pieces.length, players.length * room.pieceCount);
  assert.equal(state.playMode, room.playMode);
  assert.equal(state.itemMode, room.itemMode);
  assert.equal(state.stackedRollMode, room.stackedRollMode);
  assert.equal(state.pieceCount, room.pieceCount);
  assert.equal(state.coordinatorSeatId, 'player-1');
  assert.equal(state.startRequestVersion, 7);
  assert.equal(state.startRequestId, 'request-7');
  assert.equal(state.startCountdownEndsAt, countdownEndsAt);
});

test('시작 요청 시각을 모르는 구버전 방은 인게임 진입 시각보다 일찍 시작하지 않는다', () => {
  const countdownEndsAt = 120_000;
  const state = buildPreparedRoomGameState({
    roomId: room.id,
    room: { ...room, startRequestedAt: undefined },
    players,
    startRequestVersion: 8,
    startRequestId: 'request-8',
    countdownEndsAt,
  });
  assert.equal(state.turnOrderIntro.currentRound.startAt, countdownEndsAt);
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
