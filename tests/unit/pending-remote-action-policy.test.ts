import assert from 'node:assert/strict';
import test from 'node:test';
import { getPendingRemoteActionOptimisticApplied, isTurnFinalizingOptimisticItemAction } from '../../src/app/hooks/pendingRemoteActionPolicy';

test('방패와 함정 사용은 optimistic UI를 유지하되 후속 턴 액션을 차단한다', () => {
  for (const itemType of ['shield', 'trap'] as const) {
    const actionKey = `use_item:seat-1:12:ready:seat-1:piece-1:${itemType}:piece-1`;
    const meta = { type: 'use_item' as const, optimisticApplied: true };

    assert.equal(isTurnFinalizingOptimisticItemAction(actionKey, meta), true);
    assert.equal(getPendingRemoteActionOptimisticApplied(actionKey, meta), false);
  }
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
