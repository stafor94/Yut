import assert from 'node:assert/strict';
import test from 'node:test';
import { createGameAnimationQueue } from '../../src/app/flows/gameAnimationQueue.js';
import {
  createMoveFrameCompletionGate,
  createMoveFrameTransitionIdentityQueue,
  createMoveFrameTransitionTracker,
  getMoveFrameTransitionMs,
  isMovePositionTransitionProperty,
} from '../../src/app/flows/moveFrameCompletion.js';

const flushMicrotasks = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

test('move frame gate stays pending until the matching transition completes and consumes it once', async () => {
  const gate = createMoveFrameCompletionGate({ pieceId: 'attacker', frameKey: '7:frame-final' });
  let result = '';
  void gate.promise.then((source) => {
    result = source;
  });

  await flushMicrotasks();
  assert.equal(result, '');
  assert.equal(gate.complete({ pieceId: 'attacker', frameKey: '7:frame-final' }), true);
  assert.equal(gate.complete({ pieceId: 'attacker', frameKey: '7:frame-final' }), false);
  assert.equal(await gate.promise, 'transition');
  assert.equal(result, 'transition');
});

test('stale frame completion cannot release a newer movement frame', async () => {
  const previous = createMoveFrameCompletionGate({ pieceId: 'attacker', frameKey: '7:frame-final' });
  const next = createMoveFrameCompletionGate({ pieceId: 'attacker', frameKey: '8:frame-final' });

  assert.equal(previous.cancel(), true);
  assert.equal(await previous.promise, 'cancelled');
  assert.equal(next.complete({ pieceId: 'attacker', frameKey: '7:frame-final' }), false);
  assert.equal(next.complete({ pieceId: 'other-piece', frameKey: '8:frame-final' }), false);
  assert.equal(next.isSettled(), false);

  assert.equal(next.complete({ pieceId: 'attacker', frameKey: '8:frame-final' }), true);
  assert.equal(await next.promise, 'transition');
});

test('late same-property transitionend keeps the frame identity captured at transitionrun', () => {
  const identities = createMoveFrameTransitionIdentityQueue();
  identities.remember({ pieceId: 'attacker', frameKey: '7:old-final', propertyName: 'left' });
  identities.remember({ pieceId: 'attacker', frameKey: '8:new-final', propertyName: 'left' });

  assert.deepEqual(identities.consume('attacker', 'left'), {
    pieceId: 'attacker',
    frameKey: '7:old-final',
    propertyName: 'left',
  });
  assert.deepEqual(identities.consume('attacker', 'left'), {
    pieceId: 'attacker',
    frameKey: '8:new-final',
    propertyName: 'left',
  });
  assert.equal(identities.consume('attacker', 'left'), null);
});

test('move frame transition tracker preserves duplicate positional runs until every end or cancel settles', () => {
  const tracker = createMoveFrameTransitionTracker();
  assert.equal(tracker.start('left'), true);
  assert.equal(tracker.start('left'), true);
  assert.equal(tracker.start('top'), true);
  assert.equal(tracker.start('opacity'), false);
  assert.equal(tracker.getPendingCount(), 3);

  assert.equal(tracker.settle('left'), true);
  assert.equal(tracker.getPendingCount(), 2);
  assert.equal(tracker.hasPending(), true);
  assert.equal(tracker.settle('top'), true);
  assert.equal(tracker.hasPending(), true);
  assert.equal(tracker.settle('left'), true);
  assert.equal(tracker.hasPending(), false);
  assert.equal(tracker.settle('left'), false);
});

test('missing transition property metadata is ignored instead of breaking unrelated move presentations', () => {
  const identities = createMoveFrameTransitionIdentityQueue();
  assert.equal(isMovePositionTransitionProperty(undefined), false);
  assert.equal(isMovePositionTransitionProperty(null), false);
  assert.equal(identities.consume('attacker', undefined), null);
});

test('unmount cancellation settles only the active gate and late transition is ignored', async () => {
  const gate = createMoveFrameCompletionGate({ pieceId: 'attacker', frameKey: '9:frame-final' });
  assert.equal(gate.cancel(), true);
  assert.equal(await gate.promise, 'cancelled');
  assert.equal(gate.complete({ pieceId: 'attacker', frameKey: '9:frame-final' }), false);
});

test('queue reset cancels the current presentation gate without releasing the next frame', async () => {
  const queue = createGameAnimationQueue();
  const current = createMoveFrameCompletionGate({ pieceId: 'attacker', frameKey: '10:old-final' });
  const next = createMoveFrameCompletionGate({ pieceId: 'attacker', frameKey: '11:new-final' });
  const unsubscribe = queue.onReset?.(() => current.cancel());

  queue.reset();
  assert.equal(await current.promise, 'cancelled');
  assert.equal(next.complete({ pieceId: 'attacker', frameKey: '10:old-final' }), false);
  assert.equal(next.isSettled(), false);
  assert.equal(next.complete({ pieceId: 'attacker', frameKey: '11:new-final' }), true);
  assert.equal(await next.promise, 'transition');
  unsubscribe?.();
});

test('transitionrun re-arm cancels the missing-signal fallback and waits for transitionend', async () => {
  const gate = createMoveFrameCompletionGate({ pieceId: 'attacker', frameKey: '11:transition-run' });
  let fallback: () => void = () => assert.fail('fallback was not scheduled');
  let cancelled = false;
  assert.equal(gate.armFallback(
    { pieceId: 'attacker', frameKey: '11:transition-run' },
    220,
    (callback, delayMs) => {
      assert.equal(delayMs, 220);
      fallback = callback;
      return () => {
        cancelled = true;
      };
    },
  ), true);

  assert.equal(gate.armFallback({ pieceId: 'attacker', frameKey: '11:transition-run' }, 320), false);
  assert.equal(cancelled, true);
  fallback();
  await flushMicrotasks();
  assert.equal(gate.isSettled(), false);

  assert.equal(gate.complete({ pieceId: 'attacker', frameKey: '11:transition-run' }), true);
  assert.equal(await gate.promise, 'transition');
});

test('computed transition fallback uses the real positional duration and only fires when the signal is missing', async () => {
  assert.equal(getMoveFrameTransitionMs({
    transitionProperty: 'left, top, translate, transform',
    transitionDuration: '320ms, 320ms, 320ms, 320ms',
    transitionDelay: '0s, 0s, 0s, 0s',
  }), 320);
  assert.equal(getMoveFrameTransitionMs({
    transitionProperty: 'left, top, translate, transform',
    transitionDuration: '160ms',
    transitionDelay: '0s',
  }), 160);
  assert.equal(getMoveFrameTransitionMs({
    transitionProperty: 'left, opacity',
    transitionDuration: '320ms, 900ms',
    transitionDelay: '-40ms, 0ms',
  }), 280);

  const gate = createMoveFrameCompletionGate({ pieceId: 'attacker', frameKey: '12:frame-final' });
  let scheduledDelay = -1;
  let fallback: () => void = () => assert.fail('fallback was not scheduled');
  let cancelled = false;
  const scheduled = gate.armFallback(
    { pieceId: 'attacker', frameKey: '12:frame-final' },
    320,
    (callback, delayMs) => {
      scheduledDelay = delayMs;
      fallback = callback;
      return () => {
        cancelled = true;
      };
    },
  );
  assert.equal(scheduled, true);
  assert.equal(scheduledDelay, 320);
  assert.equal(gate.isSettled(), false);

  assert.equal(gate.complete({ pieceId: 'attacker', frameKey: '12:frame-final' }), true);
  assert.equal(cancelled, true);
  fallback();
  assert.equal(await gate.promise, 'transition');

  const lostSignalGate = createMoveFrameCompletionGate({ pieceId: 'attacker', frameKey: '13:frame-final' });
  let lostSignalFallback: () => void = () => assert.fail('lost-signal fallback was not scheduled');
  lostSignalGate.armFallback(
    { pieceId: 'attacker', frameKey: '13:frame-final' },
    160,
    (callback, delayMs) => {
      assert.equal(delayMs, 160);
      lostSignalFallback = callback;
      return () => undefined;
    },
  );
  assert.equal(lostSignalGate.isSettled(), false);
  lostSignalFallback();
  assert.equal(await lostSignalGate.promise, 'fallback');
});
