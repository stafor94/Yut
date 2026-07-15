import assert from 'node:assert/strict';
import test from 'node:test';
import { createGamePresentationLock } from '../../src/shared/gamePresentationLock.js';
import {
  REMOTE_ROLL_PRESENTATION_MS,
  REMOTE_ROLL_RESULT_HOLD_MS,
  createGameAnimationQueue,
  enqueueRollPresentation,
  getRollPresentationAnimationId,
} from '../../src/app/flows/gameAnimationQueue.js';
import { REMOTE_ROLL_PRE_RESULT_MS } from '../../src/app/flows/yutRollAnimation.js';

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

test('remote roll presentation preserves 1.4 seconds for the settled result', () => {
  assert.equal(REMOTE_ROLL_RESULT_HOLD_MS, 1400);
  assert.equal(REMOTE_ROLL_PRESENTATION_MS, REMOTE_ROLL_PRE_RESULT_MS + REMOTE_ROLL_RESULT_HOLD_MS);
  assert.equal(REMOTE_ROLL_PRESENTATION_MS - REMOTE_ROLL_PRE_RESULT_MS, 1400);
});

test('stale remote animation timestamps restart from the local presentation time', () => {
  assert.equal(getRollPresentationAnimationId(1_000, 9_000), 9_000);
  assert.equal(getRollPresentationAnimationId(12_000, 9_000), 12_000);
});

test('queued remote rolls use the actual execution time and lock gameplay while waiting', async () => {
  const queue = createGameAnimationQueue();
  const lock = createGamePresentationLock();
  const firstGate = createDeferred();
  let now = 9_000;
  let presentedAnimationId = 0;

  const first = queue.enqueue('move-before-fall', async () => {
    await firstGate.promise;
  });
  const fall = enqueueRollPresentation({
    key: 'remote-fall',
    animation: { id: 1_000, result: '낙' },
    queue,
    lock,
    now: () => now,
    task: (animation) => {
      presentedAnimationId = animation.id;
    },
  });

  await flushMicrotasks();
  assert.equal(lock.isLocked(), true);
  assert.equal(presentedAnimationId, 0);

  now = 12_000;
  firstGate.resolve();
  await Promise.all([first, fall]);
  assert.equal(presentedAnimationId, 12_000);
  await flushMicrotasks();
  assert.equal(lock.isLocked(), false);
});

test('game animations run strictly in enqueue order', async () => {
  const queue = createGameAnimationQueue();
  const firstGate = createDeferred();
  const order: string[] = [];

  const first = queue.enqueue('roll-1', async () => {
    order.push('roll-start');
    await firstGate.promise;
    order.push('roll-end');
  });
  const second = queue.enqueue('move-1', async () => {
    order.push('move-start');
    order.push('move-end');
  });

  await flushMicrotasks();
  assert.deepEqual(order, ['roll-start']);
  assert.equal(queue.isBusy(), true);

  firstGate.resolve();
  await Promise.all([first, second]);
  assert.deepEqual(order, ['roll-start', 'roll-end', 'move-start', 'move-end']);
  assert.equal(queue.isBusy(), false);
});

test('the same pending animation key is only queued once', async () => {
  const queue = createGameAnimationQueue();
  const gate = createDeferred();
  let runCount = 0;

  const first = queue.enqueue('roll-duplicate', async () => {
    runCount += 1;
    await gate.promise;
  });
  const duplicate = queue.enqueue('roll-duplicate', async () => {
    runCount += 1;
  });

  assert.equal(first, duplicate);
  assert.equal(queue.has('roll-duplicate'), true);
  gate.resolve();
  await first;
  assert.equal(runCount, 1);
  assert.equal(queue.has('roll-duplicate'), false);
});

test('a failed animation does not block animations behind it', async () => {
  const queue = createGameAnimationQueue();
  const order: string[] = [];

  const failed = queue.enqueue('broken-roll', async () => {
    order.push('broken');
    throw new Error('animation failed');
  });
  const next = queue.enqueue('following-move', async () => {
    order.push('following');
  });

  await assert.rejects(failed, /animation failed/);
  await next;
  assert.deepEqual(order, ['broken', 'following']);
});

test('reset discards queued animations that have not started', async () => {
  const queue = createGameAnimationQueue();
  const gate = createDeferred();
  const order: string[] = [];

  const active = queue.enqueue('active', async () => {
    order.push('active-start');
    await gate.promise;
    order.push('active-end');
  });
  const queued = queue.enqueue('queued', async () => {
    order.push('queued-start');
  });

  await flushMicrotasks();
  queue.reset();
  gate.resolve();
  await Promise.all([active, queued]);

  assert.deepEqual(order, ['active-start', 'active-end']);
  assert.equal(queue.isBusy(), false);
});

test('an immediate remount keeps the active animation queue', async () => {
  const queue = createGameAnimationQueue();
  const gate = createDeferred();
  const order: string[] = [];
  const releaseFirstMount = queue.acquire();

  const active = queue.enqueue('strict-mode-roll', async () => {
    order.push('roll-start');
    await gate.promise;
    order.push('roll-end');
  });
  const queued = queue.enqueue('strict-mode-move', async () => {
    order.push('move-start');
  });

  await flushMicrotasks();
  releaseFirstMount();
  const releaseSecondMount = queue.acquire();
  await Promise.resolve();

  assert.equal(queue.isBusy(), true);
  assert.equal(queue.has('strict-mode-move'), true);
  gate.resolve();
  await Promise.all([active, queued]);
  assert.deepEqual(order, ['roll-start', 'roll-end', 'move-start']);

  releaseSecondMount();
  await Promise.resolve();
  assert.equal(queue.isBusy(), false);
});
