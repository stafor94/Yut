import assert from 'node:assert/strict';
import test from 'node:test';
import { scheduleTurnTransitionBoundary } from '../../src/app/flows/turnTransitionClock';

type ScheduledCallback = {
  callback: () => void;
  delayMs: number;
  id: ReturnType<typeof setTimeout>;
};

test('turn transition callback이 목표 시각보다 일찍 실행되면 남은 시간으로 다시 예약한다', () => {
  let now = 1_000;
  let reached = 0;
  let nextId = 1;
  const scheduled: ScheduledCallback[] = [];

  scheduleTurnTransitionBoundary(1_100, () => {
    reached += 1;
  }, {
    now: () => now,
    setTimeout: (callback, delayMs) => {
      const id = nextId as unknown as ReturnType<typeof setTimeout>;
      nextId += 1;
      scheduled.push({ callback, delayMs, id });
      return id;
    },
    clearTimeout: () => {},
  });

  assert.equal(scheduled.length, 1);
  assert.equal(scheduled[0].delayMs, 100);

  now = 1_099;
  scheduled.shift()?.callback();

  assert.equal(reached, 0);
  assert.equal(scheduled.length, 1);
  assert.equal(scheduled[0].delayMs, 1);

  now = 1_100;
  scheduled.shift()?.callback();

  assert.equal(reached, 1);
  assert.equal(scheduled.length, 0);
});

test('turn transition 예약을 해제하면 최신 timer를 정리하고 callback을 실행하지 않는다', () => {
  let reached = 0;
  let scheduledCallback: (() => void) | undefined;
  let clearedId: ReturnType<typeof setTimeout> | undefined;
  const timerId = 7 as unknown as ReturnType<typeof setTimeout>;

  const cancel = scheduleTurnTransitionBoundary(2_000, () => {
    reached += 1;
  }, {
    now: () => 1_000,
    setTimeout: (callback) => {
      scheduledCallback = callback;
      return timerId;
    },
    clearTimeout: (id) => {
      clearedId = id;
    },
  });

  cancel();
  scheduledCallback?.();

  assert.equal(clearedId, timerId);
  assert.equal(reached, 0);
});
