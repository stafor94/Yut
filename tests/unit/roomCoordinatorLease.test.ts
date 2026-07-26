import assert from 'node:assert/strict';
import test from 'node:test';
import {
  decideGameCoordinatorLeaseClaim,
  getGameCoordinatorLeaseSnapshot,
  matchesActiveGameCoordinatorLease,
} from '../../src/features/room/services/roomCoordinatorLease.js';

const seats = [
  { id: 'seat-1' },
  { id: 'seat-2' },
  { id: 'ai-seat', isAI: true },
];

test('활성 lease는 현재 owner만 같은 epoch로 갱신한다', () => {
  const state = { gameSeats: seats, coordinatorSeatId: 'seat-1', coordinatorEpoch: 3, coordinatorLeaseExpiresAt: 20_000 };
  assert.deepEqual(decideGameCoordinatorLeaseClaim(state, 'seat-2', 10_000, 15_000), {
    status: 'held', coordinatorSeatId: 'seat-1', coordinatorEpoch: 3, coordinatorLeaseExpiresAt: 20_000,
  });
  assert.deepEqual(decideGameCoordinatorLeaseClaim(state, 'seat-1', 10_000, 15_000), {
    status: 'renewed', coordinatorSeatId: 'seat-1', coordinatorEpoch: 3, coordinatorLeaseExpiresAt: 25_000,
  });
});

test('만료되거나 부적격한 owner는 새 human이 더 높은 epoch로 승계한다', () => {
  const expired = { gameSeats: seats, coordinatorSeatId: 'seat-1', coordinatorEpoch: 4, coordinatorLeaseExpiresAt: 9_999 };
  assert.deepEqual(decideGameCoordinatorLeaseClaim(expired, 'seat-2', 10_000, 15_000), {
    status: 'acquired', coordinatorSeatId: 'seat-2', coordinatorEpoch: 5, coordinatorLeaseExpiresAt: 25_000,
  });

  const substituted = { gameSeats: [{ id: 'seat-1', isSubstitutedByAI: true }, { id: 'seat-2' }], coordinatorSeatId: 'seat-1', coordinatorEpoch: 5, coordinatorLeaseExpiresAt: 30_000 };
  assert.equal(decideGameCoordinatorLeaseClaim(substituted, 'seat-2', 10_000).status, 'acquired');

  const automatedOwner = { gameSeats: seats, autoPlayBySeatId: { 'seat-1': true }, coordinatorSeatId: 'seat-1', coordinatorEpoch: 6, coordinatorLeaseExpiresAt: 30_000 };
  assert.deepEqual(decideGameCoordinatorLeaseClaim(automatedOwner, 'seat-2', 10_000, 15_000), {
    status: 'acquired', coordinatorSeatId: 'seat-2', coordinatorEpoch: 7, coordinatorLeaseExpiresAt: 25_000,
  });
});

test('AI, 자동 플레이 중인 human 또는 존재하지 않는 좌석은 lease를 획득하지 못한다', () => {
  const state = { gameSeats: seats, coordinatorSeatId: '', coordinatorEpoch: 0, coordinatorLeaseExpiresAt: 0 };
  assert.equal(decideGameCoordinatorLeaseClaim(state, 'ai-seat', 10_000).status, 'ineligible');
  assert.equal(decideGameCoordinatorLeaseClaim({ ...state, autoPlayBySeatId: { 'seat-1': true } }, 'seat-1', 10_000).status, 'ineligible');
  assert.equal(decideGameCoordinatorLeaseClaim(state, 'missing', 10_000).status, 'ineligible');
});

test('owner와 epoch가 같고 만료 전인 token만 coordinator write에 유효하다', () => {
  const state = { gameSeats: seats, coordinatorSeatId: 'seat-2', coordinatorEpoch: 7, coordinatorLeaseExpiresAt: 20_000 };
  assert.equal(matchesActiveGameCoordinatorLease(state, { coordinatorSeatId: 'seat-2', coordinatorEpoch: 7 }, 19_999), true);
  assert.equal(matchesActiveGameCoordinatorLease(state, { coordinatorSeatId: 'seat-2', coordinatorEpoch: 6 }, 19_999), false);
  assert.equal(matchesActiveGameCoordinatorLease(state, { coordinatorSeatId: 'seat-1', coordinatorEpoch: 7 }, 19_999), false);
  assert.equal(matchesActiveGameCoordinatorLease(state, { coordinatorSeatId: 'seat-2', coordinatorEpoch: 7 }, 20_000), false);
});

test('Firestore Timestamp 형태 lease 만료 시각을 밀리초로 정규화한다', () => {
  const state = { coordinatorSeatId: 'seat-1', coordinatorEpoch: 2, coordinatorLeaseExpiresAt: { toMillis: () => 12_345 } };
  assert.equal(getGameCoordinatorLeaseSnapshot(state).coordinatorLeaseExpiresAt, 12_345);
});
