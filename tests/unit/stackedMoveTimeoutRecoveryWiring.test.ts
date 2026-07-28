import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const hookSource = readFileSync('src/app/hooks/useStackedRollTimeoutRecovery.ts', 'utf8');
const recoveryServiceSource = readFileSync('src/features/room/services/coordinatorMoveTimeoutRecovery.ts', 'utf8');
const roomServiceCoreSource = readFileSync('src/features/room/services/roomServiceCore.ts', 'utf8');
const qaHelperSource = readFileSync('tests/helpers/stacked-roll-timeout.js', 'utf8');

test('미선택 이동 스택 timeout은 일반 actor commit이 아니라 coordinator recovery transaction을 사용한다', () => {
  assert.match(hookSource, /import \{ commitCoordinatorMoveTimeoutRecovery \} from '.+coordinatorMoveTimeoutRecovery';/);
  assert.match(hookSource, /commitCoordinatorMoveTimeoutRecovery\(roomId, action\)/);
  assert.doesNotMatch(hookSource, /commitAuthoritativeGameAction\(roomId, action\)/);
});

test('coordinator recovery는 reducer 검증 후 lease·sequence·action key가 있는 saveGameState로 저장한다', () => {
  assert.match(recoveryServiceSource, /reduceAuthoritativeGameAction\(state, action,/);
  assert.match(recoveryServiceSource, /if \(!isAuthoritativeCommitReduction\(reduction\)\) return reduction;/);
  assert.match(recoveryServiceSource, /saveGameState\(roomId, stateForSave,/);
  assert.match(recoveryServiceSource, /coordinatorSeatId: action\.payload\.coordinatorSeatId/);
  assert.match(recoveryServiceSource, /coordinatorEpoch,/);
  assert.match(recoveryServiceSource, /clientMutationId: clientActionId/);
  assert.match(recoveryServiceSource, /expectedPreviousSequence: currentSequence/);
});

test('공통 saveGameState는 processed action, expected sequence, 현재 coordinator lease를 모두 검사한다', () => {
  assert.match(roomServiceCoreSource, /if \(processedActionSnapshot\.exists\(\)\) return/);
  assert.match(roomServiceCoreSource, /currentSequence !== meta\.expectedPreviousSequence/);
  assert.match(roomServiceCoreSource, /!hasCurrentCoordinatorLease\(currentState, getCoordinatorLeaseTokenFromMeta\(meta\)\)/);
});

test('stacked timeout QA fixture는 클라이언트 snapshot guard를 통과하도록 상태 전환마다 turnVersion을 증가시킨다', () => {
  assert.match(qaHelperSource, /fixtureTurnVersion = Math\.max\(1, Number\(state\.turnVersion \?\? 0\) \+ 1\)/);
  assert.match(qaHelperSource, /expiredTurnVersion = fixtureTurnVersion \+ 1/);
  assert.match(qaHelperSource, /turnVersion: fixtureTurnVersion/);
  assert.match(qaHelperSource, /turnVersion: expiredTurnVersion/);
});

test('stacked timeout QA fixture는 sequence replay와 snapshot 적용이 idle인 뒤에만 주입된다', () => {
  assert.match(qaHelperSource, /Number\(debug\.lastAppliedStateVersion \?\? 0\) === stateVersion/);
  assert.match(qaHelperSource, /Number\(debug\.lastAppliedSequence \?\? 0\) === sequence/);
  assert.match(qaHelperSource, /syncPipeline\.applyingSyncedState === false/);
  assert.match(qaHelperSource, /syncPipeline\.sequenceReplayInProgress === false/);
  assert.match(qaHelperSource, /syncPipeline\.onlineAuthoritativeGameStatePending === false/);
  assert.match(qaHelperSource, /syncPipeline\.authoritativeGameStateReady === true/);
});

test('stacked timeout QA fixture는 Firestore 기록뿐 아니라 클라이언트 move snapshot 적용까지 확인한다', () => {
  assert.match(qaHelperSource, /Number\(debug\.lastAppliedStateVersion \?\? 0\) === fixtureTurnVersion/);
  assert.match(qaHelperSource, /debug\.turnDeadlineKind === 'move'/);
  assert.match(qaHelperSource, /Number\(debug\.turnDeadlineAt \?\? 0\) === visibleDeadlineAt/);
  assert.match(qaHelperSource, /message: '클라이언트가 stacked timeout fixture snapshot을 실제로 적용해야 합니다\.'/);
});
