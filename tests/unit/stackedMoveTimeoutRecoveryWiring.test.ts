import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const hookSource = readFileSync('src/app/hooks/useStackedRollTimeoutRecovery.ts', 'utf8');
const recoveryServiceSource = readFileSync('src/features/room/services/coordinatorMoveTimeoutRecovery.ts', 'utf8');
const roomServiceCoreSource = readFileSync('src/features/room/services/roomServiceCore.ts', 'utf8');

 test('미선택 이동 스택 timeout은 일반 actor commit이 아니라 coordinator recovery transaction을 사용한다', () => {
  assert.match(hookSource, /import \{ commitCoordinatorMoveTimeoutRecovery \} from '.+coordinatorMoveTimeoutRecovery';/);
  assert.match(hookSource, /commitCoordinatorMoveTimeoutRecovery\(roomId, action\)/);
  assert.doesNotMatch(hookSource, /commitAuthoritativeGameAction\(roomId, action\)/);
});

test('coordinator recovery는 reducer 검증 후 lease·sequence·action key가 있는 saveGameState로 저장한다', () => {
  assert.match(recoveryServiceSource, /reduceAuthoritativeGameAction\(state, action,/);
  assert.match(recoveryServiceSource, /if \(!isAuthoritativeCommitReduction\(reduction\)\) return reduction;/);
  assert.match(recoveryServiceSource, /saveGameState\(roomId, stateForSave,/);
  assert.match(recoveryServiceSource, /coordinatorSeatId: String\(action\.payload\.coordinatorSeatId\)/);
  assert.match(recoveryServiceSource, /coordinatorEpoch: Number\(action\.payload\.coordinatorEpoch\)/);
  assert.match(recoveryServiceSource, /clientMutationId: clientActionId/);
  assert.match(recoveryServiceSource, /expectedPreviousSequence: currentSequence/);
});

test('공통 saveGameState는 processed action, expected sequence, 현재 coordinator lease를 모두 검사한다', () => {
  assert.match(roomServiceCoreSource, /if \(processedActionSnapshot\.exists\(\)\) return/);
  assert.match(roomServiceCoreSource, /currentSequence !== meta\.expectedPreviousSequence/);
  assert.match(roomServiceCoreSource, /!hasCurrentCoordinatorLease\(currentState, getCoordinatorLeaseTokenFromMeta\(meta\)\)/);
});
