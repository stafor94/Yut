import assert from 'node:assert/strict';
import test from 'node:test';
import {
  beginLocalMovePresentationForPendingAction,
  LocalMovePresentationLifecycle,
  shouldBeginLocalMovePresentation,
} from '../../src/app/flows/localMovePresentationLifecycle';

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

test('같은 action key의 후속 등록은 lifecycle generation과 waiter를 재생성하지 않는다', async () => {
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

test('ownership 등록 시 lifecycle이 idle이어도 실제 말 프레임을 관찰할 때까지 finalization을 대기한다', async () => {
  const lifecycle = new LocalMovePresentationLifecycle();
  const actionKey = 'move_piece:P1:10:0:piece-1';

  assert.equal(lifecycle.expectNextSettlement(actionKey, 'piece-1'), true);
  let settled = false;
  const settlement = lifecycle.waitForSettlement().then(() => {
    settled = true;
  });
  await Promise.resolve();
  assert.equal(settled, false);
  assert.equal(lifecycle.settle(), false);
  assert.equal(lifecycle.observe('different-piece'), false);
  assert.equal(settled, false);

  assert.equal(lifecycle.observe('piece-1'), true);
  assert.deepEqual(lifecycle.snapshot(), {
    generation: 1,
    actionKey,
    pieceId: 'piece-1',
    phase: 'presenting',
  });
  await Promise.resolve();
  assert.equal(settled, false);
  assert.equal(lifecycle.settle(), false);
  await Promise.resolve();
  assert.equal(settled, false);
  assert.equal(lifecycle.settle('piece-1'), true);
  await settlement;
  assert.equal(settled, true);
  assert.equal(lifecycle.isActive(), false);
});

test('최종 위치가 먼저 관찰돼도 실제 이동 경로 전체가 순서대로 끝나기 전에는 settlement하지 않는다', async () => {
  const lifecycle = new LocalMovePresentationLifecycle();
  const actionKey = 'move_piece:P1:10:0:piece-1';
  const pathNodeIds = ['n02', 'n03', 'n04'];
  lifecycle.begin(actionKey);
  lifecycle.expectNextSettlement(actionKey, 'piece-1');

  let settled = false;
  const settlement = lifecycle.waitForSettlement().then(() => {
    settled = true;
  });

  assert.equal(lifecycle.observe('piece-1', 'n04', pathNodeIds), true);
  assert.equal(lifecycle.settle('piece-1'), false);
  await Promise.resolve();
  assert.equal(settled, false);

  assert.equal(lifecycle.observe('piece-1', 'n02', pathNodeIds), true);
  assert.equal(lifecycle.settle('piece-1'), false);
  assert.equal(lifecycle.observe('piece-1', 'n03', pathNodeIds), true);
  assert.equal(lifecycle.settle('piece-1'), false);
  assert.equal(lifecycle.observe('piece-1', 'n04', pathNodeIds), true);
  assert.equal(lifecycle.settle('piece-1'), true);

  await settlement;
  assert.equal(settled, true);
  assert.equal(lifecycle.isActive(), false);
});

test('local move presentation은 실제 GameBoard 프레임 관찰 뒤 settlement될 때까지 유지된다', async () => {
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
  assert.equal(lifecycle.settle(), false);
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

test('관찰 전 취소도 ownership waiter를 해제한다', async () => {
  const lifecycle = new LocalMovePresentationLifecycle();
  lifecycle.expectNextSettlement('move_piece:P1:10:0:piece-1', 'piece-1');
  const settlement = lifecycle.waitForSettlement();
  assert.equal(lifecycle.cancel(), true);
  await settlement;
  assert.equal(lifecycle.cancel(), false);
});
