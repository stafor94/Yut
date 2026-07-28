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

test('stacked timeout QA fixture는 state와 sequence를 atomic commit해 sequence-first 클라이언트에 전달한다', () => {
  assert.match(qaHelperSource, /const commitUrl = `\$\{getFirestoreDocumentsBaseUrl\(config\.projectId\)\}:commit`/);
  assert.match(qaHelperSource, /'sequences', makeSequenceDocId\(nextSequence\)/);
  assert.match(qaHelperSource, /currentDocument: \{ exists: false \}/);
  assert.match(qaHelperSource, /stateFields\.lastSequence = encodeFirestoreValue\(nextSequence\)/);
  assert.match(qaHelperSource, /patch: encodeFirestoreValue\(patch\)/);
  assert.match(qaHelperSource, /visibleFixture = await commitRoomStatePatchForQa/);
  assert.match(qaHelperSource, /expiredFixture = await commitRoomStatePatchForQa/);
  assert.doesNotMatch(qaHelperSource, /method: 'PATCH'/);
});

test('stacked timeout QA fixture는 기존 sequence와 snapshot 적용이 idle인 뒤에만 다음 fixture를 commit한다', () => {
  assert.match(qaHelperSource, /Number\(debug\.lastAppliedStateVersion \?\? 0\) === stateVersion/);
  assert.match(qaHelperSource, /Number\(debug\.lastAppliedSequence \?\? 0\) === sequence/);
  assert.match(qaHelperSource, /syncPipeline\.applyingSyncedState === false/);
  assert.match(qaHelperSource, /syncPipeline\.sequenceReplayInProgress === false/);
  assert.match(qaHelperSource, /syncPipeline\.onlineAuthoritativeGameStatePending === false/);
  assert.match(qaHelperSource, /syncPipeline\.authoritativeGameStateReady === true/);
});

test('stacked timeout QA fixture는 초기·만료 sequence가 클라이언트에 실제 적용된 뒤 UI와 recovery를 검증한다', () => {
  assert.match(qaHelperSource, /hasClientAppliedFixture\(screen, visibleFixture, visibleDeadlineAt\)/);
  assert.match(qaHelperSource, /hasClientAppliedFixture\(screen, expiredFixture, timeoutDeadlineAt\)/);
  assert.match(qaHelperSource, /debug\.turnDeadlineKind === 'move'/);
  assert.match(qaHelperSource, /Number\(debug\.turnDeadlineAt \?\? 0\) === deadlineAt/);
});
