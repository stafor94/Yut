import assert from 'node:assert/strict';
import test from 'node:test';
import { getQaDelayMs, getQaInitializeGameStateDelayMs, getQaRequestRoomGameStartDelayMs, getQaRollYutActionDelayMs } from '../../src/app/config/qaDelays.js';
import { getSequenceRefetchAfter } from '../../src/app/utils/sequenceRefetch.js';
import { getSeededTurnOrderSeats, getStableTurnOrderScore } from '../../src/app/utils/turnOrderSeed.js';
const seats = [
  { id: 'player-a', label: '1P', name: '가람', color: '#d94a38' },
  { id: 'player-b', label: '2P', name: '나래', color: '#2f6b4f' },
  { id: 'player-c', label: '3P', name: '다온', color: '#3267b1' },
  { id: 'player-d', label: '4P', name: '라온', color: '#8055a5' },
];

test('seeded turn order는 기존 stable hash 점수와 label fallback으로 정렬한다', () => {
  const seed = 'room-a:3';
  const expected = [...seats].sort((left, right) => {
    const scoreDiff = getStableTurnOrderScore(seed, left.id) - getStableTurnOrderScore(seed, right.id);
    return scoreDiff || left.label.localeCompare(right.label, undefined, { numeric: true });
  });

  assert.deepEqual(getSeededTurnOrderSeats(seats, seed).map((seat) => seat.id), expected.map((seat) => seat.id));
});

test('동일 seed와 seat 입력은 동일 순서를 반환하고 원본 배열을 변경하지 않는다', () => {
  const seed = 'room-b:7';
  const originalOrder = seats.map((seat) => seat.id);
  const first = getSeededTurnOrderSeats(seats, seed).map((seat) => seat.id);
  const second = getSeededTurnOrderSeats(seats, seed).map((seat) => seat.id);

  assert.deepEqual(first, second);
  assert.deepEqual(seats.map((seat) => seat.id), originalOrder);
});

test('sequence refetch 시작값은 sequence보다 2 작되 음수가 되지 않는다', () => {
  assert.equal(getSequenceRefetchAfter(0), 0);
  assert.equal(getSequenceRefetchAfter(1), 0);
  assert.equal(getSequenceRefetchAfter(2), 0);
  assert.equal(getSequenceRefetchAfter(3), 1);
  assert.equal(getSequenceRefetchAfter(10), 8);
});

test('QA delay window 값이 없거나 잘못된 값이면 기존 fallback을 유지한다', () => {
  const previousWindow = (globalThis as typeof globalThis & { window?: Record<string, unknown> }).window;
  try {
    Reflect.deleteProperty(globalThis, 'window');
    assert.equal(getQaRequestRoomGameStartDelayMs(), 0);

    (globalThis as typeof globalThis & { window?: Record<string, unknown> }).window = {
      __YUT_QA_DELAY_REQUEST_ROOM_GAME_START_MS__: '125',
      __YUT_QA_DELAY_INITIALIZE_GAME_STATE_MS__: '-30',
      __YUT_QA_DELAY_ROLL_YUT_ACTION_MS__: 'not-a-number',
    };

    assert.equal(getQaDelayMs('__YUT_QA_DELAY_REQUEST_ROOM_GAME_START_MS__'), 125);
    assert.equal(getQaInitializeGameStateDelayMs(), 0);
    assert.equal(getQaRollYutActionDelayMs(), 0);
  } finally {
    if (previousWindow === undefined) Reflect.deleteProperty(globalThis, 'window');
    else (globalThis as typeof globalThis & { window?: Record<string, unknown> }).window = previousWindow;
  }
});
