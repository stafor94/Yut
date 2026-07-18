import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getPendingRemoteActionOptimisticApplied,
  syncPendingRemoteActionItemPromptTiming,
} from '../../src/app/hooks/pendingRemoteActionPolicy';

test('item actions block the next turn action until authoritative confirmation', () => {
  syncPendingRemoteActionItemPromptTiming('after_roll');
  assert.equal(getPendingRemoteActionOptimisticApplied(
    'use_item:p1:1:0:도:1:::stack:0:',
    { type: 'use_item', optimisticApplied: true },
  ), false);
  assert.equal(getPendingRemoteActionOptimisticApplied(
    'move_piece:p1:1:0:도:1:p1-piece-1',
    { type: 'move_piece', optimisticApplied: true },
  ), true);
});
