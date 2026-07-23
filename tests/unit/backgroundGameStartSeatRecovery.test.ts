import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildPreparedRoomGameState,
  isCompleteRoomGamePlayerSnapshot,
  type GameStartPreparationPlayer,
  type GameStartPreparationRoom,
} from '../../src/app/flows/gameStartPreparation.js';
import { hasCompletePreparedGameSeats } from '../../src/features/room/services/roomGamePreparationPolicy.js';

const room: GameStartPreparationRoom = {
  id: 'room-background-start',
  hostId: 'human-1',
  maxPlayers: 3,
  itemMode: true,
  playMode: 'individual',
  pieceCount: 4,
};

const completePlayers: GameStartPreparationPlayer[] = [
  { id: 'human-1', nickname: '사용자', color: 'red', seatIndex: 0, team: '청팀', ready: true },
  { id: 'ai-2', nickname: 'AI 둘', color: 'blue', seatIndex: 1, team: '청팀', ready: true, isAI: true },
  { id: 'ai-3', nickname: 'AI 셋', color: 'green', seatIndex: 2, team: '청팀', ready: true, isAI: true },
];

test('백그라운드 복귀 시 서버의 인간 1명과 AI 2명 좌석을 완전한 시작 스냅샷으로 인정한다', () => {
  assert.equal(isCompleteRoomGamePlayerSnapshot(room, completePlayers), true);

  const state = buildPreparedRoomGameState({
    roomId: room.id,
    room,
    players: completePlayers,
    startRequestVersion: 4,
    startRequestId: 'request-background',
    countdownEndsAt: 100_000,
  });

  assert.equal(state.gameSeats.length, 3);
  assert.deepEqual(state.turnOrderIds, []);
  assert.deepEqual(state.initialTurnOrderIds, []);
  assert.equal(state.turnOrderIntro.order.length, 3);
  assert.deepEqual(new Set(state.turnOrderIntro.currentRound.eligibleSeatIds), new Set(['human-1', 'ai-2', 'ai-3']));
  assert.equal(state.pieces.length, 12);
  assert.deepEqual(new Set(state.gameSeats.map((seat) => seat.id)), new Set(['human-1', 'ai-2', 'ai-3']));
  assert.equal(hasCompletePreparedGameSeats(state.gameSeats, room.maxPlayers), true);
});

test('클라이언트에 현재 사용자 한 명만 복원된 순간 상태는 게임 시작용으로 인정하지 않는다', () => {
  const hostOnlyPlayers = [completePlayers[0]];
  assert.equal(isCompleteRoomGamePlayerSnapshot(room, hostOnlyPlayers), false);

  const hostOnlyState = buildPreparedRoomGameState({
    roomId: room.id,
    room,
    players: hostOnlyPlayers,
    startRequestVersion: 4,
    startRequestId: 'request-background',
    countdownEndsAt: 100_000,
  });
  assert.equal(hasCompletePreparedGameSeats(hostOnlyState.gameSeats, room.maxPlayers), false);
});

test('좌석 번호나 플레이어 ID가 중복된 스냅샷은 거부한다', () => {
  const duplicatedSeatPlayers: GameStartPreparationPlayer[] = [
    completePlayers[0],
    { ...completePlayers[1], seatIndex: 0 },
    completePlayers[2],
  ];
  assert.equal(isCompleteRoomGamePlayerSnapshot(room, duplicatedSeatPlayers), false);

  const duplicatedPreparedSeats = [
    { id: 'human-1', seatIndex: 0 },
    { id: 'ai-2', seatIndex: 1 },
    { id: 'ai-2', seatIndex: 2 },
  ];
  assert.equal(hasCompletePreparedGameSeats(duplicatedPreparedSeats, room.maxPlayers), false);
});
