import assert from 'node:assert/strict';
import test from 'node:test';
import { createRollPresentationCompletion } from '../../src/app/flows/rollPresentationCompletion.js';

test('renderer onSettled가 누락되면 watchdog이 completion을 종료하고 result hold를 추가로 기다리지 않는다', async () => {
  let holdCalls = 0;
  const completion = createRollPresentationCompletion({
    watchdogMs: 0,
    resultHoldMs: 10_000,
    waitForHold: async () => {
      holdCalls += 1;
    },
  });

  assert.equal(await completion.waitForCompletion(), 'watchdog');
  assert.equal(holdCalls, 0);
});

test('renderer가 정상 settle되면 기존 result hold를 유지한다', async () => {
  const holdDurations: number[] = [];
  const completion = createRollPresentationCompletion({
    watchdogMs: 10_000,
    resultHoldMs: 125,
    waitForHold: async (durationMs) => {
      holdDurations.push(durationMs);
    },
  });

  completion.markSettled('three-renderer');
  assert.equal(await completion.waitForCompletion(), 'three-renderer');
  assert.deepEqual(holdDurations, [125]);
});

test('watchdog 이후 늦은 renderer settle 신호는 완료 결과를 바꾸지 않는다', async () => {
  const completion = createRollPresentationCompletion({
    watchdogMs: 0,
    resultHoldMs: 0,
    waitForHold: async () => undefined,
  });

  assert.equal(await completion.waitForVisualSettle(), 'watchdog');
  completion.markSettled('css-animation-end');
  assert.equal(await completion.waitForResultHold(), 'held');
});

test('취소는 watchdog과 result hold 모두를 중단한다', async () => {
  const completion = createRollPresentationCompletion({
    watchdogMs: 10_000,
    resultHoldMs: 10_000,
  });

  completion.cancel();
  assert.equal(await completion.waitForCompletion(), 'cancelled');
});
