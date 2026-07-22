import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getClientActionStartedAt,
  getTurnActionDeadlineDelayMs,
  isManualTurnActionDeadlineExpired,
  isTurnActionDeadlineExpired,
  normalizeTurnDeadlineKind,
} from '../../src/features/room/services/turnDeadlinePolicy';

test('클라이언트 액션 제한시간은 authoritative deadline 기준으로 만료된다', () => {
  assert.equal(isTurnActionDeadlineExpired({ deadlineAt: 10_000, deadlineKind: 'roll', phase: 'roll', now: 9_999 }), false);
  assert.equal(isTurnActionDeadlineExpired({ deadlineAt: 10_000, deadlineKind: 'roll', phase: 'roll', now: 10_000 }), true);
  assert.equal(isTurnActionDeadlineExpired({ deadlineAt: 10_000, deadlineKind: 'move', phase: 'roll', now: 12_000 }), false);
});

test('authoritative deadline이 있으면 로컬 전체 duration 대신 남은 시간을 사용한다', () => {
  assert.equal(getTurnActionDeadlineDelayMs({ deadlineAt: 10_000, deadlineKind: 'roll', phase: 'roll', fallbackMs: 15_000, now: 7_500 }), 2_500);
  assert.equal(getTurnActionDeadlineDelayMs({ deadlineAt: 10_000, deadlineKind: 'move', phase: 'roll', fallbackMs: 15_000, now: 7_500 }), 15_000);
  assert.equal(getTurnActionDeadlineDelayMs({ deadlineAt: 10_000, deadlineKind: 'roll', phase: 'roll', fallbackMs: 15_000, now: 10_500 }), 0);
});

test('client action id에서 던지기 시작 시각을 추출한다', () => {
  assert.equal(getClientActionStartedAt('roll_yut:p1:10000:abc123'), 10_000);
  assert.equal(getClientActionStartedAt('invalid-action-id'), 0);
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
