import assert from 'node:assert/strict';
import test from 'node:test';
import {
  bindPendingFallPresentationEffect,
  createPendingFallPresentationCompletion,
  shouldClearPendingFallPresentation,
} from '../../src/app/flows/fallPresentationCompletion';

test('낙 애니메이션이 끝났고 authoritative effect가 없으면 미결 상태를 정리한다', () => {
  const pending = createPendingFallPresentationCompletion({
    presentationActorId: 'seat-stale',
    sourceAnimationId: 17,
    fallEffect: null,
  });

  assert.equal(pending.authoritativeEffectId, null);
  assert.equal(shouldClearPendingFallPresentation(pending, null), true);
});

test('늦게 도착한 authoritative effect가 actor와 effect id를 교정한다', () => {
  const pending = createPendingFallPresentationCompletion({
    presentationActorId: 'seat-stale',
    sourceAnimationId: 17,
    fallEffect: null,
  });
  const bound = bindPendingFallPresentationEffect(pending, { id: 91, seatId: 'seat-ai' });

  assert.deepEqual(bound, {
    actorId: 'seat-ai',
    sourceAnimationId: 17,
    authoritativeEffectId: 91,
  });
  assert.equal(shouldClearPendingFallPresentation(bound, null), true);
});

test('authoritative effect가 존재하는 동안에는 pending을 정리하지 않는다', () => {
  const effect = { id: 91, seatId: 'seat-ai' };
  const pending = createPendingFallPresentationCompletion({
    presentationActorId: 'seat-stale',
    sourceAnimationId: 17,
    fallEffect: effect,
  });

  assert.equal(pending.actorId, 'seat-ai');
  assert.equal(shouldClearPendingFallPresentation(pending, effect), false);
});
