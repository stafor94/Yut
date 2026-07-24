import assert from 'node:assert/strict';
import test from 'node:test';
import { enqueueCapturePresentation } from '../../src/app/flows/capturePresentationQueue.js';
import { createGameAnimationQueue } from '../../src/app/flows/gameAnimationQueue.js';
import { createGamePresentationLock } from '../../src/shared/gamePresentationLock.js';

const createDeferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
};

const waitForCondition = async (predicate: () => boolean, message: string) => {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) return;
    await Promise.resolve();
  }
  assert.fail(message);
};

test('capture presentation waits for movement, blocks following animations, and holds the action lock', async () => {
  const queue = createGameAnimationQueue();
  const lock = createGamePresentationLock();
  const movementGate = createDeferred();
  const captureGate = createDeferred();
  const order: string[] = [];

  const movement = queue.enqueue('move:piece-1', async () => {
    order.push('move-start');
    await movementGate.promise;
    order.push('move-end');
  });
  const capture = enqueueCapturePresentation({
    key: 'capture:1',
    durationMs: 720,
    queue,
    lock,
    start: () => {
      order.push('capture-start');
    },
    wait: async (durationMs) => {
      assert.equal(durationMs, 720);
      order.push('capture-hold');
      await captureGate.promise;
      order.push('capture-end');
    },
  });
  const following = queue.enqueue('move:piece-2', () => {
    order.push('following-move');
  });

  await waitForCondition(() => order.length >= 1, 'movement task did not start');
  assert.deepEqual(order, ['move-start']);
  assert.equal(lock.isLocked(), true);

  movementGate.resolve();
  await waitForCondition(() => order.length >= 4, 'capture task did not start after movement');
  assert.deepEqual(order, ['move-start', 'move-end', 'capture-start', 'capture-hold']);
  assert.equal(lock.isLocked(), true);

  captureGate.resolve();
  await Promise.all([movement, capture, following]);
  assert.deepEqual(order, ['move-start', 'move-end', 'capture-start', 'capture-hold', 'capture-end', 'following-move']);
  await waitForCondition(() => !lock.isLocked(), 'capture presentation lock did not release');
});

test('a capture task can cancel before presentation without waiting for its duration', async () => {
  const queue = createGameAnimationQueue();
  const lock = createGamePresentationLock();
  let waitCount = 0;

  await enqueueCapturePresentation({
    key: 'capture:cancelled',
    durationMs: 720,
    queue,
    lock,
    start: () => false,
    wait: async () => {
      waitCount += 1;
    },
  });

  assert.equal(waitCount, 0);
  await waitForCondition(() => !lock.isLocked(), 'cancelled capture presentation lock did not release');
});
