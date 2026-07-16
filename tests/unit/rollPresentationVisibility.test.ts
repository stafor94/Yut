import assert from 'node:assert/strict';
import test from 'node:test';
import {
  EMPTY_ROLL_PRESENTATION_STATE,
  getCompletedRollPresentationId,
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

test('완료된 같은 animation id는 authoritative 상태가 남아 있어도 지연 잠금을 해제한다', () => {
  assert.equal(shouldDeferRollDerivedContent({
    rollAnimationId: 40,
    completedPresentationId: 40,
    presentation: EMPTY_ROLL_PRESENTATION_STATE,
  }), false);

  assert.equal(shouldDeferRollDerivedContent({
    rollAnimationId: 41,
    completedPresentationId: 40,
    presentation: EMPTY_ROLL_PRESENTATION_STATE,
  }), true);
});

test('연출 종료 전환에서 완료 animation id를 기록하고 새 연출 시작 시 초기화한다', () => {
  const activePresentation = {
    active: true,
    actorId: 'seat-ai',
    fallCount: 1,
    sourceAnimationId: 50,
    resultVisible: true,
  };
  const completedId = getCompletedRollPresentationId({
    previousPresentation: activePresentation,
    nextPresentation: EMPTY_ROLL_PRESENTATION_STATE,
  });
  assert.equal(completedId, 50);

  const nextPresentation = {
    active: true,
    actorId: 'seat-user',
    fallCount: 0,
    sourceAnimationId: 51,
    resultVisible: false,
  };
  assert.equal(getCompletedRollPresentationId({
    previousPresentation: EMPTY_ROLL_PRESENTATION_STATE,
    nextPresentation,
    completedPresentationId: completedId,
  }), null);
});
