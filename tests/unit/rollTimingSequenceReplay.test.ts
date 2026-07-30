import assert from 'node:assert/strict';
import test from 'node:test';
import { applySequenceEvent } from '../../src/app/hooks/applySequenceEvent.js';

const baseState = () => ({
  roll: null,
  logs: [],
  lastSequence: 1,
  turnVersion: 1,
});

for (const timingZone of ['nice', 'bad'] as const) {
  test(`원격 ${timingZone} sequence는 등급과 서버 확정 낙 개수를 손실 없이 재생한다`, () => {
    const displayRoll = { name: '낙', steps: 0, fallCount: timingZone === 'nice' ? 1 : 4 };
    const event = {
      sequence: 2,
      payload: { timingZone, fallCount: displayRoll.fallCount, displayRoll },
      stateAfter: {
        ...baseState(),
        roll: { name: '낙', steps: 0, fallCount: displayRoll.fallCount },
        lastRollTimingZone: timingZone,
        lastSequence: 2,
        turnVersion: 2,
      },
    };

    const result = applySequenceEvent(baseState(), event);
    assert.deepEqual(result?.roll, {
      name: '낙',
      steps: 0,
      fallCount: displayRoll.fallCount,
      presentationTimingGrade: timingZone,
    });
    assert.deepEqual(event.payload.displayRoll, {
      ...displayRoll,
      presentationTimingGrade: timingZone,
    });
    assert.equal((result?.roll as { fallCount?: number } | null)?.fallCount, displayRoll.fallCount);
  });
}
