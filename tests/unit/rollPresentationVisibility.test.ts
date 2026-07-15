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

  assert.equal(isRollPresentationResultVisible(landing, 10), false);
  assert.equal(isRollPresentationResultVisible(resultHold, null), false);
  assert.equal(isRollPresentationResultVisible(resultHold, 10), true);
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
