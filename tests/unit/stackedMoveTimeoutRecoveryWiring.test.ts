import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const hookSource = readFileSync('src/app/hooks/useStackedRollTimeoutRecovery.ts', 'utf8');
const recoveryServiceSource = readFileSync('src/features/room/services/coordinatorMoveTimeoutRecovery.ts', 'utf8');
const roomServiceCoreSource = readFileSync('src/features/room/services/roomServiceCore.ts', 'utf8');
const authoritativeFixtureSource = readFileSync('tests/helpers/authoritative-state-fixture.js', 'utf8');
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

test('공통 authoritative QA fixture는 state와 sequence를 atomic commit하고 stacked timeout QA가 이를 재사용한다', () => {
  assert.match(authoritativeFixtureSource, /const commitUrl = `\$\{getFirestoreDocumentsBaseUrl\(config\.projectId\)\}:commit`/);
  assert.match(authoritativeFixtureSource, /'sequences', makeSequenceDocId\(nextSequence\)/);
  assert.match(authoritativeFixtureSource, /currentDocument: \{ exists: false \}/);
  assert.match(authoritativeFixtureSource, /stateFields\.lastSequence = encodeFirestoreValue\(nextSequence\)/);
  assert.match(authoritativeFixtureSource, /patch: encodeFirestoreValue\(patch\)/);
  assert.doesNotMatch(authoritativeFixtureSource, /method: 'PATCH'/);

  assert.match(qaHelperSource, /import \{ commitAuthoritativeStatePatchForQa \} from '\.\/authoritative-state-fixture\.js';/);
  assert.match(qaHelperSource, /const commitRoomStatePatchForQa = \(page, roomId, patch, actorId\) => commitAuthoritativeStatePatchForQa\(/);
  assert.match(qaHelperSource, /VISIBLE_FIXTURE_DEADLINE_OFFSET_MS = 9_000/);
  assert.match(qaHelperSource, /visibleDeadlineAt = Date\.now\(\) \+ VISIBLE_FIXTURE_DEADLINE_OFFSET_MS/);
  assert.match(qaHelperSource, /visibleFixture = await commitRoomStatePatchForQa/);
  assert.match(qaHelperSource, /expiredFixture = await commitRoomStatePatchForQa/);
  assert.doesNotMatch(qaHelperSource, /method: 'PATCH'/);
});
