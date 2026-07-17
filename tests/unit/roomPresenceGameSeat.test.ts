import assert from 'node:assert/strict';
import test from 'node:test';
import { updateGameSeatControlState } from '../../src/features/room/services/roomPresenceGameSeat.js';

test('AI 대체 시 해당 좌석의 게임 snapshot 제어 상태와 epoch를 함께 갱신한다', () => {
  const next = updateGameSeatControlState([
    { id: 'host', seatIndex: 0, name: '방장', isAI: false },
    { id: 'guest', seatIndex: 1, name: '게스트', isAI: false, isSubstitutedByAI: false, presenceEpoch: 2 },
  ], {
    playerId: 'guest',
    seatIndex: 1,
    isAI: true,
    isSubstitutedByAI: true,
    presenceEpoch: 3,
  });

  assert.deepEqual(next?.[0], { id: 'host', seatIndex: 0, name: '방장', isAI: false });
  assert.deepEqual(next?.[1], {
    id: 'guest', seatIndex: 1, name: '게스트', isAI: true, isSubstitutedByAI: true, presenceEpoch: 3,
  });
});

test('원 플레이어 복귀 시 AI 제어 상태를 사람으로 되돌린다', () => {
  const next = updateGameSeatControlState([
    { id: 'guest', seatIndex: 1, name: '게스트', isAI: true, isSubstitutedByAI: true, presenceEpoch: 4 },
  ], {
    playerId: 'guest',
    seatIndex: 1,
    isAI: false,
    isSubstitutedByAI: false,
    presenceEpoch: 5,
  });

  assert.deepEqual(next?.[0], {
    id: 'guest', seatIndex: 1, name: '게스트', isAI: false, isSubstitutedByAI: false, presenceEpoch: 5,
  });
});

test('대상 좌석이 없거나 이미 같은 상태면 gameSeats patch를 만들지 않는다', () => {
  assert.equal(updateGameSeatControlState([], {
    playerId: 'guest', seatIndex: 1, isAI: false, isSubstitutedByAI: false, presenceEpoch: 1,
  }), null);
  assert.equal(updateGameSeatControlState([
    { id: 'guest', seatIndex: 1, isAI: false, isSubstitutedByAI: false, presenceEpoch: 1 },
  ], {
    playerId: 'guest', seatIndex: 1, isAI: false, isSubstitutedByAI: false, presenceEpoch: 1,
  }), null);
});
