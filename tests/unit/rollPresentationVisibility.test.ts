import assert from 'node:assert/strict';
import test from 'node:test';
import {
  EMPTY_ROLL_PRESENTATION_STATE,
  isRollPresentationResultVisible,
  shouldDeferRollDerivedContent,
} from '../../src/app/flows/rollPresentationVisibility.js';

const result = { name: '도', steps: 1 } as const;
const sticks = [] as const;

test('roll-derived UI remains hidden until the presented result has settled', () => {
  const landing = { id: 10, phase: 'landing', result, sticks } as const;
  const resultHold = { id: 10, phase: 'result-hold', result, sticks } as const;
  const resolvedWithoutPhase = { id: 10, result, sticks } as const;

  assert.equal(isRollPresentationResultVisible(landing, 10), false);
  assert.equal(isRollPresentationResultVisible(resultHold, null), false);
  assert.equal(isRollPresentationResultVisible(resultHold, 10), true);
  assert.equal(isRollPresentationResultVisible(resolvedWithoutPhase, 10), true);
});

test('authoritative stack and logs are deferred for a new or queued presentation', () => {
  assert.equal(shouldDeferRollDerivedContent({
    rollAnimationId: 20,
    presentation: EMPTY_ROLL_PRESENTATION_STATE,
  }), true);
  assert.equal(shouldDeferRollDerivedContent({
    rollAnimationId: 20,
    presentation: {
      active: true,
      actorId: 'seat-1',
      fallCount: 0,
      sourceAnimationId: 20,
      resultVisible: false,
    },
  }), true);
  assert.equal(shouldDeferRollDerivedContent({
    rollAnimationId: 20,
    presentation: {
      active: true,
      actorId: 'seat-1',
      fallCount: 0,
      sourceAnimationId: 20,
      resultVisible: true,
    },
  }), false);
  assert.equal(shouldDeferRollDerivedContent({
    rollAnimationId: null,
    presentation: {
      active: true,
      actorId: 'seat-2',
      fallCount: 0,
      sourceAnimationId: 30,
      resultVisible: false,
    },
  }), true);
  assert.equal(shouldDeferRollDerivedContent({
    rollAnimationId: null,
    presentation: EMPTY_ROLL_PRESENTATION_STATE,
  }), false);
});

test('결과 표시가 끝난 같은 animation id는 presentation 종료 후에도 지연 잠금을 해제한다', () => {
  const animationId = 7401;
  const activePresentation = {
    active: true,
    actorId: 'seat-ai',
    fallCount: 1,
    sourceAnimationId: animationId,
    resultVisible: true,
  };

  assert.equal(shouldDeferRollDerivedContent({
    rollAnimationId: animationId,
    presentation: activePresentation,
  }), false);
  assert.equal(shouldDeferRollDerivedContent({
    rollAnimationId: animationId,
    presentation: EMPTY_ROLL_PRESENTATION_STATE,
  }), false);
});

test('완료된 이전 ID가 있어도 새 animation은 presentation 시작 전까지 계속 지연한다', () => {
  const completedAnimationId = 7501;
  assert.equal(shouldDeferRollDerivedContent({
    rollAnimationId: completedAnimationId,
    presentation: {
      active: true,
      actorId: 'seat-ai',
      fallCount: 0,
      sourceAnimationId: completedAnimationId,
      resultVisible: true,
    },
  }), false);

  assert.equal(shouldDeferRollDerivedContent({
    rollAnimationId: 7502,
    presentation: EMPTY_ROLL_PRESENTATION_STATE,
  }), true);
});
