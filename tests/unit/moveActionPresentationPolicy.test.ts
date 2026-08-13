import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getMoveActionButtonText,
  getMoveControlsActionReady,
  getMoveSeatTransitionPhase,
} from '../../src/app/flows/moveActionPresentationPolicy.js';

test('같은 플레이어의 roll→move phase는 실제 좌석 turn 교체로 표시하지 않는다', () => {
  const seatTransitionPhase = getMoveSeatTransitionPhase({
    actionableTurnKey: 'P1',
    displayAt: 1_000,
    readyAt: 2_000,
    now: 3_000,
  });
  const readiness = getMoveControlsActionReady({
    seatTransitionPhase,
    hasAuthoritativeDeadline: true,
    authoritativeReadyAt: 4_200,
    now: 3_000,
    turnActionPhase: 'move',
    moveRequestReady: true,
  });
  assert.equal(seatTransitionPhase, 'ready');
  assert.equal(readiness.actionReady, false);
  assert.equal(getMoveActionButtonText({
    turnActionTimedOut: false,
    seatTransitionPhase,
    hasRoll: true,
    rollResultHolding: false,
    authoritativeActionReady: readiness.authoritativeActionReady,
    pendingTrapPlacement: false,
    waitingForOnlineTurnOrder: false,
    hasActiveTurnOrderIntro: false,
  }), '결과 확인 중...');
});

test('move phase controls는 canonical move request readiness가 false면 활성화하지 않는다', () => {
  const blocked = getMoveControlsActionReady({
    seatTransitionPhase: 'ready',
    hasAuthoritativeDeadline: true,
    authoritativeReadyAt: 2_000,
    now: 3_000,
    turnActionPhase: 'move',
    moveRequestReady: false,
  });
  assert.equal(blocked.authoritativeActionReady, true);
  assert.equal(blocked.actionReady, false);

  const ready = getMoveControlsActionReady({
    seatTransitionPhase: 'ready',
    hasAuthoritativeDeadline: true,
    authoritativeReadyAt: 2_000,
    now: 3_000,
    turnActionPhase: 'move',
    moveRequestReady: true,
  });
  assert.equal(ready.actionReady, true);
});

test('roll phase는 move request readiness와 독립적으로 기존 전환 gate를 유지한다', () => {
  const readiness = getMoveControlsActionReady({
    seatTransitionPhase: 'ready',
    hasAuthoritativeDeadline: false,
    authoritativeReadyAt: 0,
    now: 3_000,
    turnActionPhase: 'roll',
    moveRequestReady: false,
  });
  assert.equal(readiness.actionReady, true);
});

test('실제 플레이어 turn 교체에서만 전환 문구를 사용한다', () => {
  assert.equal(getMoveActionButtonText({
    turnActionTimedOut: false,
    seatTransitionPhase: 'ending',
    hasRoll: false,
    rollResultHolding: false,
    authoritativeActionReady: false,
    pendingTrapPlacement: false,
    waitingForOnlineTurnOrder: false,
    hasActiveTurnOrderIntro: false,
  }), '턴 전환 중...');
  assert.equal(getMoveActionButtonText({
    turnActionTimedOut: false,
    seatTransitionPhase: 'starting',
    hasRoll: false,
    rollResultHolding: false,
    authoritativeActionReady: false,
    pendingTrapPlacement: false,
    waitingForOnlineTurnOrder: false,
    hasActiveTurnOrderIntro: false,
  }), '잠시 후 행동 가능');
});
