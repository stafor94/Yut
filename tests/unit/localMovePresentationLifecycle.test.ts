import assert from 'node:assert/strict';
import test from 'node:test';
import {
  beginLocalMovePresentationForPendingAction,
  LocalMovePresentationLifecycle,
  shouldBeginLocalMovePresentation,
  shouldDeferAuthoritativeStateForLocalMove,
} from '../../src/app/flows/localMovePresentationLifecycle';

test('authoritative 상태는 pending 정리 여부와 무관하게 active local move presentation 동안 보류한다', () => {
  assert.equal(shouldDeferAuthoritativeStateForLocalMove({ hasPendingLocalMove: true, presentationActive: true }), true);
  assert.equal(shouldDeferAuthoritativeStateForLocalMove({ hasPendingLocalMove: false, presentationActive: true }), true);
  assert.equal(shouldDeferAuthoritativeStateForLocalMove({ hasPendingLocalMove: true, presentationActive: false }), false);
});

test('낙관적 local move pending 등록만 presentation lifecycle을 선점한다', () => {
  assert.equal(shouldBeginLocalMovePresentation({ actionKey: 'move_piece:P1:10:0:piece-1', actionType: 'move_piece', optimisticApplied: true }), true);
  assert.equal(shouldBeginLocalMovePresentation({ actionKey: 'move_piece:P1:10:0:piece-1', actionType: 'move_piece', optimisticApplied: false }), false);
  assert.equal(shouldBeginLocalMovePresentation({ actionKey: 'roll_yut:P1:10', actionType: 'roll_yut', optimisticApplied: true }), false);

  const lifecycle = new LocalMovePresentationLifecycle();
  assert.equal(beginLocalMovePresentationForPendingAction({
    lifecycle,
    actionKey: 'move_piece:P1:10:0:piece-1',
    actionType: 'move_piece',
    optimisticApplied: true,
  }), true);
  assert.deepEqual(lifecycle.snapshot(), {
    generation: 1,
    actionKey: 'move_piece:P1:10:0:piece-1',
    pieceId: '',
    phase: 'pending',
  });
});

test('같은 action key의 후속 enqueue 등록은 lifecycle generation과 waiter를 재생성하지 않는다', async () => {
  const lifecycle = new LocalMovePresentationLifecycle();
  const actionKey = 'move_piece:P1:10:0:piece-1';
  const generation = lifecycle.begin(actionKey);
  lifecycle.observe('piece-1');
  const firstSettlement = lifecycle.waitForSettlement();

  assert.equal(lifecycle.begin(actionKey), generation);
  assert.equal(lifecycle.waitForSettlement(), firstSettlement);
  assert.deepEqual(lifecycle.snapshot(), {
    generation,
    actionKey,
    pieceId: 'piece-1',
    phase: 'presenting',
  });

  lifecycle.settle('piece-1');
  await firstSettlement;
  assert.equal(lifecycle.isActive(), false);
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
