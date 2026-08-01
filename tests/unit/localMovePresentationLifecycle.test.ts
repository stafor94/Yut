import assert from 'node:assert/strict';
import test from 'node:test';
import {
  LocalMovePresentationLifecycle,
  shouldDeferAuthoritativeStateForLocalMove,
} from '../../src/app/flows/localMovePresentationLifecycle';

test('authoritative 상태는 pending local move presentation 동안만 보류한다', () => {
  assert.equal(shouldDeferAuthoritativeStateForLocalMove({ hasPendingLocalMove: true, presentationActive: true }), true);
  assert.equal(shouldDeferAuthoritativeStateForLocalMove({ hasPendingLocalMove: false, presentationActive: true }), false);
  assert.equal(shouldDeferAuthoritativeStateForLocalMove({ hasPendingLocalMove: true, presentationActive: false }), false);
});

test('local move presentation은 실제 프레임 관찰 뒤 settlement될 때까지 유지된다', async () => {
  const lifecycle = new LocalMovePresentationLifecycle();
  lifecycle.begin('move_piece:P1:10:0:n01:piece-1');
  assert.deepEqual(lifecycle.snapshot(), {
    generation: 1,
    actionKey: 'move_piece:P1:10:0:n01:piece-1',
    pieceId: '',
    phase: 'pending',
  });
  assert.equal(lifecycle.settle(), false);
  assert.equal(lifecycle.observe('piece-1'), true);

  let settled = false;
  const settlement = lifecycle.waitForSettlement().then(() => {
    settled = true;
  });
  await Promise.resolve();
  assert.equal(settled, false);
  assert.equal(lifecycle.settle('different-piece'), false);
  assert.equal(lifecycle.settle('piece-1'), true);
  await settlement;
  assert.equal(settled, true);
  assert.equal(lifecycle.isActive(), false);
});

test('새 이동 generation과 취소는 이전 waiter를 해제하고 stale settlement를 무시한다', async () => {
  const lifecycle = new LocalMovePresentationLifecycle();
  lifecycle.begin('move-1');
  lifecycle.observe('piece-1');
  const firstSettlement = lifecycle.waitForSettlement();

  lifecycle.begin('move-2');
  await firstSettlement;
  assert.deepEqual(lifecycle.snapshot(), {
    generation: 2,
    actionKey: 'move-2',
    pieceId: '',
    phase: 'pending',
  });
  assert.equal(lifecycle.settle('piece-1'), false);
  lifecycle.observe('piece-2');
  const secondSettlement = lifecycle.waitForSettlement();
  assert.equal(lifecycle.cancel(), true);
  await secondSettlement;
  assert.equal(lifecycle.isActive(), false);
  assert.equal(lifecycle.cancel(), false);
});
