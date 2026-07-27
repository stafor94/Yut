import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getPendingRemoteActionOptimisticApplied,
  isTurnFinalizingOptimisticItemAction,
  syncPendingRemoteActionItemPromptTiming,
} from '../../src/app/hooks/pendingRemoteActionPolicy';

test('방패와 함정 사용은 optimistic UI를 유지하되 후속 턴 액션을 차단한다', () => {
  for (const itemType of ['shield', 'trap'] as const) {
    const actionKey = `use_item:seat-1:12:ready:seat-1:piece-1:${itemType}:piece-1`;
    const meta = { type: 'use_item' as const, optimisticApplied: true };

    assert.equal(isTurnFinalizingOptimisticItemAction(actionKey, meta), true);
    assert.equal(getPendingRemoteActionOptimisticApplied(actionKey, meta), false);
  }
});

test('현재 action key 형식의 아이템 사용 안 함은 명시적 후속 액션 차단을 따른다', () => {
  for (const actionKey of [
    'use_item:seat-1:12:skip-before',
    'use_item:seat-1:12:skip-after',
    'use_item:seat-1:12:skip-move',
  ]) {
    const meta = { type: 'use_item' as const, optimisticApplied: true, blocksTurnActions: true };
    assert.equal(isTurnFinalizingOptimisticItemAction(actionKey, meta), false);
    assert.equal(getPendingRemoteActionOptimisticApplied(actionKey, meta), false);
  }
});

test('game sync timing 호출은 실제 skip action 차단 정책을 바꾸지 않는다', () => {
  const actionKey = 'use_item:seat-1:12:skip-before';
  const optimisticMeta = { type: 'use_item' as const, optimisticApplied: true };
  const blockingMeta = { ...optimisticMeta, blocksTurnActions: true };

  syncPendingRemoteActionItemPromptTiming('after_move');
  assert.equal(getPendingRemoteActionOptimisticApplied(actionKey, optimisticMeta), true);
  assert.equal(getPendingRemoteActionOptimisticApplied(actionKey, blockingMeta), false);
  syncPendingRemoteActionItemPromptTiming(null);
});

test('다시 던지기 등 턴을 계속하는 아이템은 비차단 optimistic 요청을 유지한다', () => {
  const actionKey = 'use_item:seat-1:12:걸:seat-1:piece-1:reroll:piece-1';
  const meta = { type: 'use_item' as const, optimisticApplied: true };

  assert.equal(isTurnFinalizingOptimisticItemAction(actionKey, meta), false);
  assert.equal(getPendingRemoteActionOptimisticApplied(actionKey, meta), true);
});

test('아이템 외 요청의 pending 정책은 변경하지 않는다', () => {
  const meta = { type: 'roll_yut' as const, optimisticApplied: true };

  assert.equal(getPendingRemoteActionOptimisticApplied('roll_yut:seat-1:12:ready', meta), true);
});
