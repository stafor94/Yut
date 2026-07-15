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

  const waiting = waitForGamePresentationBeforeAction('roll_yut', lock).then(() => {
    resolved = true;
  });

  await flushMicrotasks();
  assert.equal(resolved, false);
  release();
  await waiting;
  assert.equal(resolved, true);
});

test('fall turn advances and bonus rerolls share the same presentation lock', () => {
  assert.equal(shouldWaitForGamePresentation('roll_yut'), true);
  assert.equal(shouldWaitForGamePresentation('move_piece'), true);
  assert.equal(shouldWaitForGamePresentation('use_item'), true);
  assert.equal(shouldWaitForGamePresentation('place_trap'), true);
  assert.equal(shouldWaitForGamePresentation('item_pickup_decision'), true);
  assert.equal(shouldWaitForGamePresentation('turn_order_roll'), false);
  assert.equal(shouldWaitForGamePresentation('continue_race'), false);
});

test('all active presentation holders must release before the next action continues', async () => {
  const lock = createGamePresentationLock();
  const releaseFirst = lock.acquire();
  const releaseSecond = lock.acquire();
  let resolved = false;

  const waiting = waitForGamePresentationBeforeAction('move_piece', lock).then(() => {
    resolved = true;
  });

  releaseFirst();
  await flushMicrotasks();
  assert.equal(resolved, false);
  releaseSecond();
  await waiting;
  assert.equal(resolved, true);
});

test('an immediate remount preserves the presentation lock', async () => {
  const lock = createGamePresentationLock();
  const releaseFirstMount = lock.acquire();
  let resolved = false;
  const waiting = waitForGamePresentationBeforeAction('roll_yut', lock).then(() => {
    resolved = true;
  });

  releaseFirstMount();
  const releaseSecondMount = lock.acquire();
  await flushMicrotasks();
  assert.equal(resolved, false);

  releaseSecondMount();
  await waiting;
  assert.equal(resolved, true);
});

test('reset releases actions waiting on a discarded presentation', async () => {
  const lock = createGamePresentationLock();
  lock.acquire();
  let resolved = false;
  const waiting = waitForGamePresentationBeforeAction('move_piece', lock).then(() => {
    resolved = true;
  });

  await flushMicrotasks();
  assert.equal(resolved, false);
  lock.reset();
  await waiting;
  assert.equal(resolved, true);
  assert.equal(lock.isLocked(), false);
});

test('non-gameplay actions do not wait for a roll presentation', async () => {
  const lock = createGamePresentationLock();
  const release = lock.acquire();

  await waitForGamePresentationBeforeAction('turn_order_roll', lock);
  assert.equal(lock.isLocked(), true);

  release();
  await flushMicrotasks();
  assert.equal(lock.isLocked(), false);
});
