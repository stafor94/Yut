import assert from 'node:assert/strict';
import test from 'node:test';
import { getMoveActionReadiness } from '../../src/app/flows/moveActionReadiness.js';

const baseInput = {
  canSubmitTurnAction: true,
  rollPresentationBlocked: false,
  hasPendingMoveAction: false,
  hasValidMoveSelection: true,
  rollResultHolding: false,
  rollAnimationActive: false,
  moveInProgress: false,
  movingPieceActive: false,
};

test('online move readiness는 authoritative move deadline 없이는 열리지 않는다', () => {
  const missingDeadline = getMoveActionReadiness({
    ...baseInput,
    isOnlineMode: true,
    turnDeadlineAt: 0,
    turnDeadlineKind: 'move',
  });
  assert.equal(missingDeadline.hasAuthoritativeMoveDeadline, false);
  assert.equal(missingDeadline.actionReady, false);
  assert.equal(missingDeadline.timerReady, false);
  assert.equal(missingDeadline.authoritativeDeadlineAt, 0);

  const wrongDeadlineKind = getMoveActionReadiness({
    ...baseInput,
    isOnlineMode: true,
    turnDeadlineAt: 12_345,
    turnDeadlineKind: 'roll',
  });
  assert.equal(wrongDeadlineKind.hasAuthoritativeMoveDeadline, false);
  assert.equal(wrongDeadlineKind.actionReady, false);
  assert.equal(wrongDeadlineKind.timerReady, false);
  assert.equal(wrongDeadlineKind.authoritativeDeadlineAt, 0);
});

test('online move action과 timer는 동일 authoritative move deadline을 사용한다', () => {
  const deadlineAt = 12_345;
  const readiness = getMoveActionReadiness({
    ...baseInput,
    isOnlineMode: true,
    turnDeadlineAt: deadlineAt,
    turnDeadlineKind: 'move',
  });
  assert.equal(readiness.hasAuthoritativeMoveDeadline, true);
  assert.equal(readiness.authoritativeDeadlineKind, 'move');
  assert.equal(readiness.authoritativeDeadlineAt, deadlineAt);
  assert.equal(readiness.actionReady, true);
  assert.equal(readiness.timerReady, true);
});

test('online authoritative deadline이 있어도 기존 presentation/action gate를 우회하지 않는다', () => {
  const readiness = getMoveActionReadiness({
    ...baseInput,
    rollPresentationBlocked: true,
    isOnlineMode: true,
    turnDeadlineAt: 12_345,
    turnDeadlineKind: 'move',
  });
  assert.equal(readiness.hasAuthoritativeMoveDeadline, true);
  assert.equal(readiness.actionReady, false);
  assert.equal(readiness.timerReady, false);
});

test('offline move readiness는 authoritative deadline을 요구하지 않는다', () => {
  const readiness = getMoveActionReadiness({
    ...baseInput,
    isOnlineMode: false,
    turnDeadlineAt: 0,
    turnDeadlineKind: '',
  });
  assert.equal(readiness.actionReady, true);
  assert.equal(readiness.timerReady, false);
});
