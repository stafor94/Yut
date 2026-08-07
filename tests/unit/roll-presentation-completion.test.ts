import assert from 'node:assert/strict';
import test from 'node:test';
import { createGamePresentationLock } from '../../src/shared/gamePresentationLock.js';
import {
  createGameAnimationQueue,
  enqueueRollPresentation,
} from '../../src/app/flows/gameAnimationQueue.js';
import { createRollPresentationCompletion } from '../../src/app/flows/rollPresentationCompletion.js';

const createDeferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
};

const flushMicrotasks = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

test('remote roll presentation waits for the Three.js renderer settled signal and then holds the result', async () => {
  const hold = createDeferred();
  const completion = createRollPresentationCompletion({
    watchdogMs: 1000,
    waitForHold: () => hold.promise,
  });
  let finished = false;
  const waiting = completion.waitForCompletion().then((result) => {
    finished = true;
    return result;
  });

  await flushMicrotasks();
  assert.equal(finished, false);

  completion.markSettled('three-renderer');
  await flushMicrotasks();
  assert.equal(finished, false);

  hold.resolve();
  assert.equal(await waiting, 'three-renderer');
  assert.equal(finished, true);
});

test('terminal parent input reuses the renderer-settle completion and does not restart the result hold clock', async () => {
  const hold = createDeferred();
  let holdCalls = 0;
  const completion = createRollPresentationCompletion({
    resultHoldMs: 1000,
    watchdogMs: 1000,
    waitForHold: async () => {
      holdCalls += 1;
      await hold.promise;
    },
  });

  const visiblePresentation = completion.waitForCompletion();
  await flushMicrotasks();
  assert.equal(holdCalls, 0, 'renderer settle 전에는 result hold가 시작되면 안 됩니다.');

  completion.markSettled('three-renderer');
  await flushMicrotasks();
  assert.equal(holdCalls, 1, '실제 renderer settle이 result hold clock을 시작해야 합니다.');

  const terminalParentInput = completion.waitForCompletion();
  await flushMicrotasks();
  assert.equal(holdCalls, 1, '부모 null 입력은 같은 completion을 재사용해야 합니다.');

  hold.resolve();
  assert.equal(await visiblePresentation, 'three-renderer');
  assert.equal(await terminalParentInput, 'three-renderer');
});

test('queued remote roll keeps the presentation lock until the renderer settles', async () => {
  const queue = createGameAnimationQueue();
  const lock = createGamePresentationLock();
  const completion = createRollPresentationCompletion({ resultHoldMs: 0, watchdogMs: 1000 });

  const presentation = enqueueRollPresentation({
    key: 'remote-fall-actual-settle',
    animation: { id: 1000 },
    queue,
    lock,
    task: async () => {
      await completion.waitForCompletion();
    },
  });

  await flushMicrotasks();
  assert.equal(lock.isLocked(), true);
  assert.equal(queue.isBusy(), true);

  completion.markSettled('css-animation-end');
  await presentation;
  assert.equal(lock.isLocked(), false);
  assert.equal(queue.isBusy(), false);
});

test('watchdog completion skips the result hold through the explicit abnormal path', async () => {
  let holdCalls = 0;
  const completion = createRollPresentationCompletion({
    watchdogMs: 0,
    waitForHold: async () => {
      holdCalls += 1;
    },
  });

  assert.equal(await completion.waitForVisualSettle(), 'watchdog');
  assert.equal(await completion.waitForResultHold(), 'held');
  assert.equal(holdCalls, 0);
});

test('presentation completion can be cancelled without waiting for the result hold', async () => {
  const hold = createDeferred();
  const completion = createRollPresentationCompletion({
    watchdogMs: 1000,
    waitForHold: () => hold.promise,
  });
  const waiting = completion.waitForCompletion();

  completion.cancel();
  assert.equal(await waiting, 'cancelled');
});
