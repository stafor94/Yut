import assert from 'node:assert/strict';
import test from 'node:test';
import { createDeadlineTimerAnimationCache } from '../../src/app/flows/deadlineTimerAnimation.js';

test('the same deadline key preserves its original animation snapshot across rerenders', () => {
  let now = 1_000;
  const cache = createDeadlineTimerAnimationCache(() => now);

  const first = cache.get({ key: 'seat-1:roll:10_000', deadlineAt: 10_000, durationMs: 10_000 });
  now = 4_000;
  const rerendered = cache.get({ key: 'seat-1:roll:10_000', deadlineAt: 10_000, durationMs: 10_000 });

  assert.equal(first.delayMs, -1_000);
  assert.strictEqual(rerendered, first);
  assert.equal(rerendered.delayMs, -1_000);
});

test('a new deadline key or duration creates a fresh animation snapshot', () => {
  let now = 1_000;
  const cache = createDeadlineTimerAnimationCache(() => now);

  const first = cache.get({ key: 'seat-1:roll:10_000', deadlineAt: 10_000, durationMs: 10_000 });
  now = 4_000;
  const nextDeadline = cache.get({ key: 'seat-1:move:12_000', deadlineAt: 12_000, durationMs: 10_000 });
  now = 5_000;
  const changedDuration = cache.get({ key: 'seat-1:move:12_000', deadlineAt: 12_000, durationMs: 8_000 });

  assert.notStrictEqual(nextDeadline, first);
  assert.equal(nextDeadline.delayMs, -2_000);
  assert.notStrictEqual(changedDuration, nextDeadline);
  assert.equal(changedDuration.delayMs, -1_000);
});
