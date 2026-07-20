import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync('src/app/containers/RollStage.tsx', 'utf8');
const sessionSource = readFileSync('src/app/flows/rollPresentationSession.ts', 'utf8');
const sessionTestSource = readFileSync('tests/unit/rollPresentationSession.test.ts', 'utf8');

test('RollStage는 입력 snapshot과 화면 표시 수명주기를 presentation session으로 분리한다', () => {
  assert.match(source, /presentationSessionByIdRef/);
  assert.match(source, /applyRollPresentationInput/);
  assert.match(source, /waiting-authoritative-result|preserveDisplayedAnimation/);
  assert.doesNotMatch(source, /currentLiveSequenceIdRef/);
  assert.doesNotMatch(source, /completedLiveSequenceIdsRef/);
});

test('미완료 입력이 null로 끊기면 presentAnimation null보다 먼저 표시 유지 안전장치를 적용한다', () => {
  const nullBranchStart = source.indexOf('if (!rollAnimation) {');
  const preserveIndex = source.indexOf('if (decision.preserveDisplayedAnimation)', nullBranchStart);
  const clearIndex = source.indexOf('presentAnimation(null);', preserveIndex);

  assert.ok(nullBranchStart >= 0, 'rollAnimation null 분기가 있어야 합니다.');
  assert.ok(preserveIndex > nullBranchStart, 'null 분기에서 표시 유지 결정을 확인해야 합니다.');
  assert.ok(clearIndex > preserveIndex, '표시 제거는 유지 안전장치 이후에만 실행되어야 합니다.');
  assert.match(source.slice(preserveIndex, clearIndex), /return;/);
});

test('표시 완료와 취소는 명시적인 session terminal 상태에서만 처리한다', () => {
  assert.match(source, /markRollPresentationResultHold/);
  assert.match(source, /markRollPresentationCompleted/);
  assert.match(source, /markRollPresentationCancelled/);
  assert.match(source, /shouldPreserveRollPresentation\(displayedSession\)/);
});

test('authoritative 결과가 유실되어 sequence가 취소되면 보존 프레임을 제거하고 다음 큐를 해제한다', () => {
  const waitIndex = source.indexOf('const resolvedAnimation = await sequence.wait();');
  const cancelledIndex = source.indexOf('markRollPresentationCancelled', waitIndex);
  const sameSourceIndex = source.indexOf('presentedSourceAnimationIdRef.current === sourceAnimationId', waitIndex);
  const clearIndex = source.indexOf('presentAnimation(null);', sameSourceIndex);

  assert.ok(waitIndex >= 0);
  assert.ok(cancelledIndex > waitIndex);
  assert.ok(sameSourceIndex > cancelledIndex);
  assert.ok(clearIndex > sameSourceIndex);
});

test('상태 머신 단위 테스트는 appState의 TSX·DOM·Firebase 의존 그래프를 가져오지 않는다', () => {
  assert.doesNotMatch(sessionSource, /from ['"]\.\.\/appState['"]/);
  assert.match(sessionSource, /from ['"]\.\.\/types\/rollAnimation['"]/);
  assert.doesNotMatch(sessionTestSource, /appState\.js/);
  assert.match(sessionTestSource, /types\/rollAnimation\.js/);
});
