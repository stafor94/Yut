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

test('remote roll presentation waits for the renderer settled signal and then holds the result', async () => {
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

  completion.markSettled('renderer-settled');
  await flushMicrotasks();
  assert.equal(finished, false);

  hold.resolve();
  assert.equal(await waiting, 'renderer-settled');
  assert.equal(finished, true);
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

  completion.markSettled('renderer-settled');
  await presentation;
  assert.equal(lock.isLocked(), false);
  assert.equal(queue.isBusy(), false);
});

test('watchdog reveals the result only through the explicit abnormal completion path', async () => {
  const hold = createDeferred();
  const completion = createRollPresentationCompletion({
    watchdogMs: 0,
    waitForHold: () => hold.promise,
  });

  assert.equal(await completion.waitForVisualSettle(), 'watchdog');
  let holdFinished = false;
  const waitingForHold = completion.waitForResultHold().then((result) => {
    holdFinished = true;
    return result;
  });
  await flushMicrotasks();
  assert.equal(holdFinished, false);
  hold.resolve();
  assert.equal(await waitingForHold, 'held');
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
