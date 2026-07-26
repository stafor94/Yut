import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isEmptyClientGameCoordinatorLease,
  stabilizeClientGameCoordinatorLease,
  type ClientGameCoordinatorLease,
  type ClientGameCoordinatorLeaseContext,
} from '../../src/app/hooks/clientGameCoordinatorLease.js';

const emptyLease = (): ClientGameCoordinatorLease => ({
  coordinatorSeatId: '',
  coordinatorEpoch: 0,
  coordinatorLeaseExpiresAt: 0,
});

const activeLease = (overrides: Partial<ClientGameCoordinatorLease> = {}): ClientGameCoordinatorLease => ({
  coordinatorSeatId: 'host-seat',
  coordinatorEpoch: 7,
  coordinatorLeaseExpiresAt: 123_456,
  ...overrides,
});

const context = (
  lease: ClientGameCoordinatorLease,
  overrides: Partial<Omit<ClientGameCoordinatorLeaseContext, 'lease'>> = {},
): ClientGameCoordinatorLeaseContext => ({
  roomId: 'room-1',
  screen: 'game',
  lease,
  ...overrides,
});

test('같은 게임의 partial snapshot이 빈 lease로 정규화돼도 직전 active lease를 보존한다', () => {
  const previous = context(activeLease());
  const next = context(emptyLease());
  const stabilized = stabilizeClientGameCoordinatorLease(previous, next);

  assert.equal(stabilized.roomId, next.roomId);
  assert.equal(stabilized.screen, next.screen);
  assert.strictEqual(stabilized.lease, previous.lease);
});

test('동일 게임에서 실제 owner 또는 epoch가 포함된 lease 갱신은 그대로 적용한다', () => {
  const previous = context(activeLease());
  const next = context(activeLease({
    coordinatorSeatId: 'guest-seat',
    coordinatorEpoch: 8,
    coordinatorLeaseExpiresAt: 150_000,
  }));

  assert.strictEqual(stabilizeClientGameCoordinatorLease(previous, next), next);
});

test('방 변경이나 게임 화면 이탈 시 빈 lease를 보존하지 않고 세션을 초기화한다', () => {
  const previous = context(activeLease());
  const nextRoom = context(emptyLease(), { roomId: 'room-2' });
  const waitingRoom = context(emptyLease(), { screen: 'waitingRoom' });

  assert.strictEqual(stabilizeClientGameCoordinatorLease(previous, nextRoom), nextRoom);
  assert.strictEqual(stabilizeClientGameCoordinatorLease(previous, waitingRoom), waitingRoom);
});

test('직전 lease도 비어 있으면 빈 값을 임의 권한으로 승격하지 않는다', () => {
  const previous = context(emptyLease());
  const next = context(emptyLease());

  assert.strictEqual(stabilizeClientGameCoordinatorLease(previous, next), next);
});

test('숫자와 Firestore Timestamp 형태의 만료 시각을 모두 빈 lease 판정에서 구분한다', () => {
  assert.equal(isEmptyClientGameCoordinatorLease(emptyLease()), true);
  assert.equal(isEmptyClientGameCoordinatorLease(activeLease()), false);
  assert.equal(isEmptyClientGameCoordinatorLease(activeLease({
    coordinatorSeatId: '',
    coordinatorEpoch: 0,
    coordinatorLeaseExpiresAt: { toMillis: () => 123_456 },
  })), false);
});
