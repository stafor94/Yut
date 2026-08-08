import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isCompleteClientGameCoordinatorLease,
  isCurrentClientGameCoordinatorLeaseRequest,
  isEmptyClientGameCoordinatorLease,
  shouldApplyDisposedClientGameCoordinatorLeaseResult,
  stabilizeClientGameCoordinatorLease,
  type ClientGameCoordinatorLease,
  type ClientGameCoordinatorLeaseContext,
  type ClientGameCoordinatorLeaseRequestContext,
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

const requestContext = (
  overrides: Partial<ClientGameCoordinatorLeaseRequestContext> = {},
): ClientGameCoordinatorLeaseRequestContext => ({
  roomId: 'room-1',
  screen: 'game',
  candidateSeatId: 'host-seat',
  eligible: true,
  ...overrides,
});

test('같은 게임의 partial snapshot이 완전히 빈 lease로 정규화돼도 직전 complete lease를 보존한다', () => {
  const previous = context(activeLease());
  const next = context(emptyLease());
  const stabilized = stabilizeClientGameCoordinatorLease(previous, next);

  assert.equal(stabilized.roomId, next.roomId);
  assert.equal(stabilized.screen, next.screen);
  assert.strictEqual(stabilized.lease, previous.lease);
});

test('같은 게임의 partial snapshot이 owner만 남기고 epoch와 만료값을 0으로 만들면 직전 complete lease를 보존한다', () => {
  const previous = context(activeLease());
  const next = context(activeLease({
    coordinatorEpoch: 0,
    coordinatorLeaseExpiresAt: 0,
  }));

  assert.equal(isEmptyClientGameCoordinatorLease(next.lease), false);
  assert.equal(isCompleteClientGameCoordinatorLease(next.lease), false);
  assert.strictEqual(stabilizeClientGameCoordinatorLease(previous, next).lease, previous.lease);
});

test('동일 게임에서 complete owner와 epoch가 포함된 lease 갱신은 그대로 적용한다', () => {
  const previous = context(activeLease());
  const next = context(activeLease({
    coordinatorSeatId: 'guest-seat',
    coordinatorEpoch: 8,
    coordinatorLeaseExpiresAt: 150_000,
  }));

  assert.strictEqual(stabilizeClientGameCoordinatorLease(previous, next), next);
});

test('방 변경이나 게임 화면 이탈 시 incomplete lease를 보존하지 않고 세션을 초기화한다', () => {
  const previous = context(activeLease());
  const nextRoom = context(emptyLease(), { roomId: 'room-2' });
  const waitingRoom = context(emptyLease(), { screen: 'waitingRoom' });

  assert.strictEqual(stabilizeClientGameCoordinatorLease(previous, nextRoom), nextRoom);
  assert.strictEqual(stabilizeClientGameCoordinatorLease(previous, waitingRoom), waitingRoom);
});

test('직전 lease도 incomplete이면 빈 값이나 owner-only 값을 임의 권한으로 승격하지 않는다', () => {
  const emptyPrevious = context(emptyLease());
  const emptyNext = context(emptyLease());
  const ownerOnlyPrevious = context(activeLease({ coordinatorEpoch: 0, coordinatorLeaseExpiresAt: 0 }));
  const ownerOnlyNext = context(activeLease({ coordinatorEpoch: 0, coordinatorLeaseExpiresAt: 0 }));

  assert.strictEqual(stabilizeClientGameCoordinatorLease(emptyPrevious, emptyNext), emptyNext);
  assert.strictEqual(stabilizeClientGameCoordinatorLease(ownerOnlyPrevious, ownerOnlyNext), ownerOnlyNext);
});

test('숫자와 Firestore Timestamp 형태의 만료 시각을 complete lease 판정에 사용한다', () => {
  assert.equal(isEmptyClientGameCoordinatorLease(emptyLease()), true);
  assert.equal(isCompleteClientGameCoordinatorLease(activeLease()), true);
  assert.equal(isCompleteClientGameCoordinatorLease(activeLease({
    coordinatorLeaseExpiresAt: { toMillis: () => 123_456 },
  })), true);
  assert.equal(isCompleteClientGameCoordinatorLease(activeLease({
    coordinatorSeatId: '',
    coordinatorEpoch: 0,
    coordinatorLeaseExpiresAt: { toMillis: () => 123_456 },
  })), false);
});

test('lease deadline render로 기존 effect가 정리돼도 같은 room/game/candidate의 in-flight claim 결과는 현재 요청으로 유지한다', () => {
  const started = requestContext();
  const afterDeadlineRender = requestContext();

  assert.equal(isCurrentClientGameCoordinatorLeaseRequest(started, afterDeadlineRender), true);
});

test('room·화면·candidate·eligibility가 바뀐 뒤 도착한 이전 claim 결과는 현재 요청으로 취급하지 않는다', () => {
  const started = requestContext();

  assert.equal(isCurrentClientGameCoordinatorLeaseRequest(started, requestContext({ roomId: 'room-2' })), false);
  assert.equal(isCurrentClientGameCoordinatorLeaseRequest(started, requestContext({ screen: 'waitingRoom' })), false);
  assert.equal(isCurrentClientGameCoordinatorLeaseRequest(started, requestContext({ candidateSeatId: 'guest-seat' })), false);
  assert.equal(isCurrentClientGameCoordinatorLeaseRequest(started, requestContext({ eligible: false })), false);
});

test('disposed effect의 lease 결과는 현재 lease와 같거나 더 최신일 때만 적용한다', () => {
  const current = activeLease({ coordinatorEpoch: 7, coordinatorLeaseExpiresAt: 150_000 });

  assert.equal(shouldApplyDisposedClientGameCoordinatorLeaseResult(current, activeLease({
    coordinatorEpoch: 8,
    coordinatorLeaseExpiresAt: 160_000,
  })), true);
  assert.equal(shouldApplyDisposedClientGameCoordinatorLeaseResult(current, activeLease({
    coordinatorEpoch: 7,
    coordinatorLeaseExpiresAt: 160_000,
  })), true);
  assert.equal(shouldApplyDisposedClientGameCoordinatorLeaseResult(current, activeLease({
    coordinatorEpoch: 6,
    coordinatorLeaseExpiresAt: 200_000,
  })), false);
  assert.equal(shouldApplyDisposedClientGameCoordinatorLeaseResult(current, activeLease({
    coordinatorEpoch: 7,
    coordinatorLeaseExpiresAt: 140_000,
  })), false);
  assert.equal(shouldApplyDisposedClientGameCoordinatorLeaseResult(current, activeLease({
    coordinatorSeatId: 'guest-seat',
    coordinatorEpoch: 7,
    coordinatorLeaseExpiresAt: 160_000,
  })), false);
});
