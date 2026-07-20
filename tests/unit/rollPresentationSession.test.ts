import assert from 'node:assert/strict';
import test from 'node:test';
import type { RollAnimation } from '../../src/app/appState.js';
import {
  applyRollPresentationInput,
  markRollPresentationCompleted,
  shouldPreserveRollPresentation,
} from '../../src/app/flows/rollPresentationSession.js';

const sticks = [
  { flat: true, marked: false },
  { flat: false, marked: false },
  { flat: false, marked: false },
  { flat: false, marked: false },
];
const fallResult = { name: '낙', steps: 0 } as const;

const primary = (id = 100): RollAnimation => ({
  id,
  phase: 'primary',
  actionKey: `roll:${id}`,
  sticks,
});

const landingFall = (id = 100): RollAnimation => ({
  id,
  phase: 'landing',
  result: fallResult,
  sticks,
  fallCount: 4,
});

const resultHoldFall = (id = 100): RollAnimation => ({
  id,
  phase: 'result-hold',
  result: fallResult,
  sticks,
  fallCount: 4,
});

const resolvedFall = (id = 100): RollAnimation => ({
  id,
  phase: 'resolved',
  result: fallResult,
  sticks,
  fallCount: 4,
});

test('미완료 상대 낙 입력이 null로 끊겨도 표시를 유지하며 authoritative 결과를 기다린다', () => {
  const live = applyRollPresentationInput(null, landingFall());
  const interrupted = applyRollPresentationInput(live.session, null);

  assert.equal(live.kind, 'live');
  assert.equal(interrupted.kind, 'wait');
  assert.equal(interrupted.session?.phase, 'waiting-authoritative-result');
  assert.equal(interrupted.preserveDisplayedAnimation, true);
  assert.equal(shouldPreserveRollPresentation(interrupted.session), true);
  assert.equal(interrupted.session?.latestAnimation.phase, 'landing');
});

test('대기 중인 표시 세션은 같은 id의 authoritative 낙 결과로 이어진다', () => {
  const live = applyRollPresentationInput(null, primary());
  const waiting = applyRollPresentationInput(live.session, null);
  const resolved = applyRollPresentationInput(waiting.session, resolvedFall());

  assert.equal(waiting.session?.phase, 'waiting-authoritative-result');
  assert.equal(resolved.kind, 'resolve');
  assert.equal(resolved.session?.phase, 'resolved');
  assert.equal(resolved.session?.sourceAnimationId, 100);
  assert.equal(resolved.session?.latestAnimation.phase, 'resolved');
  assert.equal(resolved.preserveDisplayedAnimation, true);
});

test('로컬 result-hold가 끝난 뒤의 null만 라이브 시퀀스 정상 완료로 처리한다', () => {
  const live = applyRollPresentationInput(null, resultHoldFall());
  const completedLive = applyRollPresentationInput(live.session, null);

  assert.equal(completedLive.kind, 'complete-live');
  assert.equal(completedLive.session?.phase, 'result-hold');
  assert.equal(completedLive.session?.liveCompleted, true);
  assert.equal(completedLive.preserveDisplayedAnimation, true);
});

test('완료된 표시 세션만 후속 null에서 화면 제거를 허용한다', () => {
  const resolved = applyRollPresentationInput(null, resolvedFall());
  assert.ok(resolved.session);
  const completed = resolved.session ? markRollPresentationCompleted(resolved.session) : null;
  const cleared = applyRollPresentationInput(completed, null);

  assert.equal(cleared.kind, 'clear');
  assert.equal(cleared.preserveDisplayedAnimation, false);
  assert.equal(shouldPreserveRollPresentation(cleared.session), false);
});

test('새 animation id는 이전 대기 세션과 섞이지 않는 독립 세션을 만든다', () => {
  const first = applyRollPresentationInput(null, primary(100));
  const waiting = applyRollPresentationInput(first.session, null);
  const next = applyRollPresentationInput(waiting.session, landingFall(101));

  assert.equal(next.kind, 'live');
  assert.equal(next.session?.sourceAnimationId, 101);
  assert.equal(next.session?.phase, 'live');
  assert.equal(next.session?.liveCompleted, false);
});
