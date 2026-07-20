import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync('src/app/containers/RollStage.tsx', 'utf8');

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
