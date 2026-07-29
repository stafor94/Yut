import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const hookSource = readFileSync('src/app/hooks/useStackedRollTimeoutRecovery.ts', 'utf8');
const policySource = readFileSync('src/features/room/services/moveTimeoutRecoveryPolicy.ts', 'utf8');
const recoveryServiceSource = readFileSync('src/features/room/services/coordinatorMoveTimeoutRecovery.ts', 'utf8');

test('일반 roll과 누적 스택은 같은 immutable timeout context와 stable action key를 사용한다', () => {
  assert.match(hookSource, /resolveMoveTimeoutContext\(\{/);
  assert.match(hookSource, /stackedRollMode: hasStackedMoveState/);
  assert.match(hookSource, /if \(!roll && \(!rollStackClosed \|\| rollStack\.length === 0\)\) return undefined;/);
  assert.doesNotMatch(hookSource, /\|\| roll !== null/);
  assert.match(hookSource, /rollStackIndex: timeoutContext\.rollStackIndex/);
  assert.match(hookSource, /makeTimeoutActionKey\(\{[\s\S]*stage: 'move'[\s\S]*timeoutDeadlineAt: turnDeadlineAt/);
  assert.match(hookSource, /roll === null[\s\S]*'stacked-roll-selection-timeout'[\s\S]*'stalled-roll-move-timeout'/);
});

test('callback은 절대 recoveryAt과 최신 room·actor·phase·deadline·lease scope를 다시 확인한다', () => {
  assert.match(hookSource, /getMoveTimeoutRecoverySchedule\(turnDeadlineAt\)/);
  assert.match(hookSource, /isMoveTimeoutRecoveryScopeCurrent\(expectedScope, latestScopeRef\.current\)/);
  assert.match(hookSource, /if \(!currentSchedule\.ready\) \{[\s\S]*schedule\(currentSchedule\.delayMs\)/);
  assert.match(policySource, /getTurnRecoveryDeadlineAt\(turnDeadlineAt\)/);
  assert.match(policySource, /expected\.roomId === current\.roomId/);
  assert.match(policySource, /expected\.actorId === current\.actorId/);
  assert.match(policySource, /expected\.turnDeadlineAt === current\.turnDeadlineAt/);
  assert.match(policySource, /expected\.coordinatorEpoch === current\.coordinatorEpoch/);
});

test('commit과 duplicate만 terminal이며 실패는 in-flight를 해제하고 제한 횟수로 재시도한다', () => {
  assert.match(policySource, /result\.status === 'committed' \|\| result\.status === 'duplicate'/);
  assert.match(hookSource, /clearInFlight\(\);[\s\S]*scheduleRetry\(disposition/);
  assert.match(hookSource, /catch\(\(error\) => \{[\s\S]*clearInFlight\(\);[\s\S]*scheduleRetry/);
  assert.match(policySource, /attempt < retryLimit/);
  assert.match(hookSource, /console\.warn\('\[move-timeout-recovery\] recovery stopped'/);
});

test('일반 이동 timeout도 reducer와 coordinator lease·sequence·processed action transaction을 사용한다', () => {
  assert.match(hookSource, /commitCoordinatorMoveTimeoutRecovery\(roomId, action\)/);
  assert.match(recoveryServiceSource, /reduceAuthoritativeGameAction\(state, action,/);
  assert.match(recoveryServiceSource, /saveGameState\(roomId, stateForSave,/);
  assert.match(recoveryServiceSource, /clientMutationId: clientActionId/);
  assert.match(recoveryServiceSource, /expectedPreviousSequence: currentSequence/);
});
