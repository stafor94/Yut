import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createGamePresentationLock,
  shouldWaitForGamePresentation,
  waitForGamePresentationBeforeAction,
} from '../../src/shared/gamePresentationLock.js';

const flushMicrotasks = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

test('gameplay actions wait while a roll presentation is visible', async () => {
  const lock = createGamePresentationLock();
  const release = lock.acquire();
  let resolved = false;

  const waiting = waitForGamePresentationBeforeAction('roll_yut', lock, 1000).then((result) => {
    resolved = true;
    return result;
  });

  await flushMicrotasks();
  assert.equal(resolved, false);
  release();
  assert.equal(await waiting, 'idle');
  assert.equal(resolved, true);
});

test('fall turn advances and bonus rerolls share the same presentation lock', () => {
  assert.equal(shouldWaitForGamePresentation('roll_yut'), true);
  assert.equal(shouldWaitForGamePresentation('move_piece'), true);
  assert.equal(shouldWaitForGamePresentation('use_item'), true);
  assert.equal(shouldWaitForGamePresentation('place_trap'), true);
  assert.equal(shouldWaitForGamePresentation('item_pickup_decision'), true);
  assert.equal(shouldWaitForGamePresentation('continue_race'), false);
});

test('all active presentation holders must release before the next action continues', async () => {
  const lock = createGamePresentationLock();
  const releaseFirst = lock.acquire();
  const releaseSecond = lock.acquire();
  let resolved = false;

  const waiting = waitForGamePresentationBeforeAction('move_piece', lock, 1000).then((result) => {
    resolved = true;
    return result;
  });

  releaseFirst();
  await flushMicrotasks();
  assert.equal(resolved, false);
  releaseSecond();
  assert.equal(await waiting, 'idle');
  assert.equal(resolved, true);
});

test('an immediate remount preserves the presentation lock', async () => {
  const lock = createGamePresentationLock();
  const releaseFirstMount = lock.acquire();
  let resolved = false;
  const waiting = waitForGamePresentationBeforeAction('roll_yut', lock, 1000).then((result) => {
    resolved = true;
    return result;
  });

  releaseFirstMount();
  const releaseSecondMount = lock.acquire();
  await flushMicrotasks();
  assert.equal(resolved, false);

  releaseSecondMount();
  assert.equal(await waiting, 'idle');
  assert.equal(resolved, true);
});

test('reset releases actions waiting on a discarded presentation', async () => {
  const lock = createGamePresentationLock();
  lock.acquire();
  let resolved = false;
  const waiting = waitForGamePresentationBeforeAction('move_piece', lock, 1000).then((result) => {
    resolved = true;
    return result;
  });

  await flushMicrotasks();
  assert.equal(resolved, false);
  lock.reset();
  assert.equal(await waiting, 'idle');
  assert.equal(resolved, true);
  assert.equal(lock.isLocked(), false);
});

test('a missing renderer completion signal cannot block authoritative actions indefinitely', async () => {
  const lock = createGamePresentationLock();
  const release = lock.acquire();
  const startedAt = Date.now();

  const result = await waitForGamePresentationBeforeAction('move_piece', lock, 15);

  assert.equal(result, 'timeout');
  assert.ok(Date.now() - startedAt < 500);
  assert.equal(lock.isLocked(), true);
  release();
  await flushMicrotasks();
  assert.equal(lock.isLocked(), false);
});

test('a timed out waiter is removed and does not affect later presentation holders', async () => {
  const lock = createGamePresentationLock();
  const releaseFirst = lock.acquire();
  assert.equal(await lock.waitUntilIdle(0), 'timeout');
  releaseFirst();
  await flushMicrotasks();

  const releaseSecond = lock.acquire();
  let resolved = false;
  const waiting = lock.waitUntilIdle(1000).then((result) => {
    resolved = true;
    return result;
  });
  await flushMicrotasks();
  assert.equal(resolved, false);
  releaseSecond();
  assert.equal(await waiting, 'idle');
});

test('non-gameplay actions do not wait for a roll presentation', async () => {
  const lock = createGamePresentationLock();
  const release = lock.acquire();

  assert.equal(await waitForGamePresentationBeforeAction('continue_race', lock), 'idle');
  assert.equal(lock.isLocked(), true);

  release();
  await flushMicrotasks();
  assert.equal(lock.isLocked(), false);
});
