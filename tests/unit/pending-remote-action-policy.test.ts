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

test('말 이동 후 아이템 사용 안 함은 서버 확정 전 후속 턴 액션을 차단한다', () => {
  const actionKey = 'use_item:seat-1:12:4:ready:seat-1:piece-1::';
  const meta = { type: 'use_item' as const, optimisticApplied: true, itemPromptTiming: 'after_move' as const };

  assert.equal(isTurnFinalizingOptimisticItemAction(actionKey, meta), true);
  assert.equal(getPendingRemoteActionOptimisticApplied(actionKey, meta), false);
});

test('윷 던지기 전후 아이템 사용 안 함은 비차단 optimistic 요청을 유지한다', () => {
  const actionKey = 'use_item:seat-1:12:4:ready:seat-1:piece-1::';
  for (const itemPromptTiming of ['before_roll', 'after_roll'] as const) {
    const meta = { type: 'use_item' as const, optimisticApplied: true, itemPromptTiming };

    assert.equal(isTurnFinalizingOptimisticItemAction(actionKey, meta), false);
    assert.equal(getPendingRemoteActionOptimisticApplied(actionKey, meta), true);
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
