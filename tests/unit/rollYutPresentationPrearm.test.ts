import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  createGamePresentationLock,
  waitForGamePresentationBeforeAction,
} from '../../src/shared/gamePresentationLock.js';

const roomServiceSource = readFileSync('src/features/room/services/roomService.ts', 'utf8');

const flushMicrotasks = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

test('roll_yut prearmed wait ignores a presentation acquired after submission when none was active', async () => {
  const lock = createGamePresentationLock();
  const prearmedWait = waitForGamePresentationBeforeAction('roll_yut', lock, 2500);
  const releaseCurrentRoll = lock.acquire();

  assert.equal(await prearmedWait, 'idle');
  assert.equal(lock.isLocked(), true);

  releaseCurrentRoll();
  await flushMicrotasks();
  assert.equal(lock.isLocked(), false);
});

test('roll_yut prearmed wait still waits for a presentation already active at submission', async () => {
  const lock = createGamePresentationLock();
  const releasePreviousPresentation = lock.acquire();
  let resolved = false;
  const prearmedWait = waitForGamePresentationBeforeAction('roll_yut', lock, 2500).then((result) => {
    resolved = true;
    return result;
  });

  await flushMicrotasks();
  assert.equal(resolved, false);

  releasePreviousPresentation();
  assert.equal(await prearmedWait, 'idle');
  assert.equal(resolved, true);
});

test('settleRoomAction prearms only roll_yut presentation wait before any await and reuses it in commit', () => {
  const settleStart = roomServiceSource.indexOf('const settleRoomAction = async');
  const actionStart = roomServiceSource.indexOf('const actionWithClientStart =', settleStart);
  const prearmStart = roomServiceSource.indexOf('const prearmedRollPresentationWait', actionStart);
  const reservationStart = roomServiceSource.indexOf('const reservationRef =', prearmStart);
  const firstAwait = roomServiceSource.indexOf('await ', prearmStart);
  const settleCommit = roomServiceSource.indexOf('return settleAuthoritativeCommit({', prearmStart);
  const commitStart = roomServiceSource.indexOf('commit: async () => {', settleCommit);
  const prearmedAwait = roomServiceSource.indexOf('await prearmedRollPresentationWait', commitStart);
  const fallbackWait = roomServiceSource.indexOf('await waitForGamePresentationBeforeAction', prearmedAwait);
  const timeoutWarning = roomServiceSource.indexOf("presentationWaitResult === 'timeout'", prearmedAwait);
  const coreCommit = roomServiceSource.indexOf('return commitAuthoritativeGameActionCore', fallbackWait);

  assert.ok(settleStart >= 0);
  assert.ok(actionStart > settleStart);
  assert.ok(prearmStart > actionStart);
  assert.ok(reservationStart > prearmStart);
  assert.ok(firstAwait > prearmStart);
  assert.ok(settleCommit > prearmStart);
  assert.ok(commitStart > settleCommit);
  assert.ok(prearmedAwait > commitStart);
  assert.ok(fallbackWait > prearmedAwait);
  assert.ok(timeoutWarning > fallbackWait);
  assert.ok(coreCommit > timeoutWarning);

  const prearmSource = roomServiceSource.slice(prearmStart, reservationStart);
  assert.match(prearmSource, /actionWithClientStart\.type === 'roll_yut'/);
  assert.match(prearmSource, /shouldWaitForGamePresentationBeforeCommit\(actionWithClientStart\)/);
  assert.match(prearmSource, /waitForGamePresentationBeforeAction\(actionWithClientStart\.type\)/);
});
