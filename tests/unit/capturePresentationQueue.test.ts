import assert from 'node:assert/strict';
import test from 'node:test';
import { enqueueCapturePresentation } from '../../src/app/flows/capturePresentationQueue.js';
import { createGameAnimationQueue } from '../../src/app/flows/gameAnimationQueue.js';
import { createMoveFrameCompletionGate } from '../../src/app/flows/moveFrameCompletion.js';
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

test('capture presentation starts only after attacker arrival, then holds settlement and following animations', async () => {
  const queue = createGameAnimationQueue();
  const lock = createGamePresentationLock();
  const arrivalGate = createMoveFrameCompletionGate({ pieceId: 'attacker', frameKey: '1:final' });
  const captureGate = createDeferred();
  const order: string[] = [];
  let captureStartCount = 0;

  const movement = queue.enqueue('move:attacker:final', async () => {
    order.push('final-move-start');
    await arrivalGate.promise;
    order.push('attacker-arrival-complete');
  });
  const capture = enqueueCapturePresentation({
    key: 'capture:1',
    durationMs: 720,
    queue,
    lock,
    start: () => {
      captureStartCount += 1;
      order.push('capture-start');
    },
    wait: async (durationMs) => {
      assert.equal(durationMs, 720);
      order.push('capture-hold');
      await captureGate.promise;
      order.push('capture-end');
    },
  });
  const settlement = queue.enqueue('move:settled:attacker', () => {
    order.push('authoritative-settlement');
  });
  const following = queue.enqueue('next-animation', () => {
    order.push('following-animation');
  });

  await waitForCondition(() => order.length >= 1, 'final move task did not start');
  assert.deepEqual(order, ['final-move-start']);
  assert.equal(captureStartCount, 0);
  assert.equal(lock.isLocked(), true);

  arrivalGate.complete({ pieceId: 'attacker', frameKey: '1:final' });
  await waitForCondition(() => order.length >= 4, 'capture task did not start after attacker arrival');
  assert.deepEqual(order, ['final-move-start', 'attacker-arrival-complete', 'capture-start', 'capture-hold']);
  assert.equal(captureStartCount, 1);
  assert.equal(lock.isLocked(), true);

  captureGate.resolve();
  await Promise.all([movement, capture, settlement, following]);
  assert.deepEqual(order, [
    'final-move-start',
    'attacker-arrival-complete',
    'capture-start',
    'capture-hold',
    'capture-end',
    'authoritative-settlement',
    'following-animation',
  ]);
  assert.equal(captureStartCount, 1);
  await waitForCondition(() => !lock.isLocked(), 'capture presentation lock did not release');
});

test('capture presentation waits one renderer settle boundary before source and ghost become visible', async () => {
  const queue = createGameAnimationQueue();
  const lock = createGamePresentationLock();
  const visualSettleGate = createDeferred();
  const captureGate = createDeferred();
  const order: string[] = [];

  const capture = enqueueCapturePresentation({
    key: 'capture:renderer-settle',
    durationMs: 720,
    queue,
    lock,
    waitForVisualSettle: async () => {
      order.push('visual-settle-wait');
      await visualSettleGate.promise;
      order.push('visual-settle-complete');
    },
    start: () => {
      order.push('capture-start');
    },
    wait: async () => {
      order.push('capture-hold');
      await captureGate.promise;
    },
  });

  await waitForCondition(() => order.length >= 1, 'visual settle wait did not start');
  assert.deepEqual(order, ['visual-settle-wait']);
  assert.equal(lock.isLocked(), true);

  visualSettleGate.resolve();
  await waitForCondition(() => order.includes('capture-start'), 'capture started before renderer settle completed');
  assert.deepEqual(order, ['visual-settle-wait', 'visual-settle-complete', 'capture-start', 'capture-hold']);

  captureGate.resolve();
  await capture;
  await waitForCondition(() => !lock.isLocked(), 'capture presentation lock did not release after renderer-settled capture');
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
