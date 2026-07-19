import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createGameAnimationQueue,
  createGameAnimationSequence,
} from '../../src/app/flows/gameAnimationQueue.js';

const flushMicrotasks = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

test('local result-hold completion releases the next queued animation', async () => {
  const queue = createGameAnimationQueue();
  const sequence = createGameAnimationSequence<{ phase: 'result-hold' }>();
  const order: string[] = [];

  const roll = queue.enqueue('local-roll', async () => {
    order.push('roll-start');
    const terminal = await sequence.wait();
    assert.deepEqual(terminal, { phase: 'result-hold' });
    order.push('roll-end');
  });
  const move = queue.enqueue('following-move', async () => {
    order.push('move-start');
  });

  await flushMicrotasks();
  assert.deepEqual(order, ['roll-start']);
  sequence.resolve({ phase: 'result-hold' });
  await Promise.all([roll, move]);
  assert.deepEqual(order, ['roll-start', 'roll-end', 'move-start']);
});

test('a local roll completed before its queue turn is still retained', async () => {
  const queue = createGameAnimationQueue();
  const blocker = createGameAnimationSequence<void>();
  const roll = createGameAnimationSequence<{ phase: 'result-hold' }>();
  const order: string[] = [];

  const first = queue.enqueue('blocker', async () => {
    order.push('blocker-start');
    await blocker.wait();
    order.push('blocker-end');
  });
  const second = queue.enqueue('queued-local-roll', async () => {
    const terminal = await roll.wait();
    assert.deepEqual(terminal, { phase: 'result-hold' });
    order.push('roll-replayed');
  });

  roll.resolve({ phase: 'result-hold' });
  await flushMicrotasks();
  assert.deepEqual(order, ['blocker-start']);
  blocker.resolve();
  await Promise.all([first, second]);
  assert.deepEqual(order, ['blocker-start', 'blocker-end', 'roll-replayed']);
});
