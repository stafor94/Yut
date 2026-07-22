import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getClientActionStartedAt,
  getTurnActionDeadlineDelayMs,
  getTurnActionStartedAt,
  isManualTurnActionDeadlineExpired,
  isTurnActionDeadlineExpired,
  normalizeTurnDeadlineKind,
} from '../../src/features/room/services/turnDeadlinePolicy';

test('클라이언트 액션 제한시간은 authoritative deadline 기준으로 만료된다', () => {
  assert.equal(isTurnActionDeadlineExpired({ deadlineAt: 10_000, deadlineKind: 'roll', phase: 'roll', now: 9_999 }), false);
  assert.equal(isTurnActionDeadlineExpired({ deadlineAt: 10_000, deadlineKind: 'roll', phase: 'roll', now: 10_000 }), true);
  assert.equal(isTurnActionDeadlineExpired({ deadlineAt: 10_000, deadlineKind: 'move', phase: 'roll', now: 12_000 }), false);
  assert.equal(isTurnActionDeadlineExpired({ deadlineAt: 10_000, deadlineKind: 'item_prompt', phase: 'item_prompt', now: 10_000 }), true);
  assert.equal(isTurnActionDeadlineExpired({ deadlineAt: 10_000, deadlineKind: 'trap_placement', phase: 'trap_placement', now: 10_000 }), true);
});

test('authoritative deadline이 있으면 로컬 전체 duration 대신 남은 시간을 사용한다', () => {
  assert.equal(getTurnActionDeadlineDelayMs({ deadlineAt: 10_000, deadlineKind: 'roll', phase: 'roll', fallbackMs: 15_000, now: 7_500 }), 2_500);
  assert.equal(getTurnActionDeadlineDelayMs({ deadlineAt: 10_000, deadlineKind: 'move', phase: 'roll', fallbackMs: 15_000, now: 7_500 }), 15_000);
  assert.equal(getTurnActionDeadlineDelayMs({ deadlineAt: 10_000, deadlineKind: 'roll', phase: 'roll', fallbackMs: 15_000, now: 10_500 }), 0);
  assert.equal(getTurnActionDeadlineDelayMs({ deadlineAt: 10_000, deadlineKind: 'item_prompt', phase: 'item_prompt', fallbackMs: 10_000, now: 7_500 }), 2_500);
});

test('client action id와 명시 payload에서 액션 시작 시각을 추출한다', () => {
  assert.equal(getClientActionStartedAt('roll_yut:p1:10000:abc123'), 10_000);
  assert.equal(getClientActionStartedAt('invalid-action-id'), 0);
  assert.equal(getTurnActionStartedAt({ clientActionStartedAt: 9_500, clientActionId: 'roll_yut:p1:10000:abc123' }), 9_500);
  assert.equal(normalizeTurnDeadlineKind('roll'), 'roll');
  assert.equal(normalizeTurnDeadlineKind('invalid'), '');
});

test('deadline 이후 시작된 일반 던지기는 네트워크 유예 중에도 만료로 판정한다', () => {
  assert.equal(isManualTurnActionDeadlineExpired({
    deadlineAt: 10_000,
    deadlineKind: 'roll',
    expectedKind: 'roll',
    clientActionId: 'roll_yut:p1:10000:abc123',
    now: 10_200,
    networkGraceMs: 1_000,
  }), true);
});

test('deadline 직전에 시작된 요청은 네트워크 유예 동안 허용한다', () => {
  assert.equal(isManualTurnActionDeadlineExpired({
    deadlineAt: 10_000,
    deadlineKind: 'roll',
    expectedKind: 'roll',
    clientActionId: 'roll_yut:p1:9999:abc123',
    now: 10_200,
    networkGraceMs: 1_000,
  }), false);
});

test('deadline 직전 요청도 네트워크 유예가 끝난 뒤 도착하면 거부한다', () => {
  assert.equal(isManualTurnActionDeadlineExpired({
    deadlineAt: 10_000,
    deadlineKind: 'roll',
    expectedKind: 'roll',
    clientActionId: 'roll_yut:p1:9999:abc123',
    now: 11_000,
    networkGraceMs: 1_000,
  }), true);
});

test('명시된 item prompt 시작 시각이 deadline 이후면 즉시 거부한다', () => {
  assert.equal(isManualTurnActionDeadlineExpired({
    deadlineAt: 10_000,
    deadlineKind: 'item_prompt',
    expectedKind: 'item_prompt',
    clientActionStartedAt: 10_001,
    now: 10_100,
    networkGraceMs: 1_000,
  }), true);
});

test('시작 시각이 없는 현재 액션은 정책에 따라 grace 이후 거부할 수 있다', () => {
  assert.equal(isManualTurnActionDeadlineExpired({
    deadlineAt: 10_000,
    deadlineKind: 'move',
    expectedKind: 'move',
    clientActionId: 'move-piece-without-time',
    now: 10_999,
    networkGraceMs: 1_000,
    missingStartedAtPolicy: 'reject-after-grace',
  }), false);
  assert.equal(isManualTurnActionDeadlineExpired({
    deadlineAt: 10_000,
    deadlineKind: 'move',
    expectedKind: 'move',
    clientActionId: 'move-piece-without-time',
    now: 11_000,
    networkGraceMs: 1_000,
    missingStartedAtPolicy: 'reject-after-grace',
  }), true);
});

test('시작 시각이 없는 레거시·내부 던지기는 기존 reducer 검증에 맡긴다', () => {
  assert.equal(isManualTurnActionDeadlineExpired({
    deadlineAt: 10_000,
    deadlineKind: 'roll',
    expectedKind: 'roll',
    clientActionId: 'legacy-action',
    now: 20_000,
    networkGraceMs: 1_000,
  }), false);
});
