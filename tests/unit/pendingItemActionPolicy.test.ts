import assert from 'node:assert/strict';
import test from 'node:test';
import { getPendingRemoteActionOptimisticApplied } from '../../src/app/hooks/pendingRemoteActionPolicy';

test('optimistic presentation과 후속 턴 액션 차단은 독립적으로 지정한다', () => {
  const skipMeta = { type: 'use_item' as const, optimisticApplied: true, blocksTurnActions: true };
  assert.equal(getPendingRemoteActionOptimisticApplied('use_item:p1:1:0:skip-before', skipMeta), false);

  const rerollMeta = { type: 'use_item' as const, optimisticApplied: true };
  assert.equal(getPendingRemoteActionOptimisticApplied('use_item:p1:1:0:reroll', rerollMeta), true);
});
