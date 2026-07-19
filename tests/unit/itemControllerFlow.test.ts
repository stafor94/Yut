import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildSkipItemPromptPayload,
  getSkippedItemPromptNextDeadlineKind,
  isCurrentItemPromptRequestRoom,
} from '../../src/app/flows/itemControllerFlow';

describe('itemControllerFlow', () => {
  it('builds authoritative skip payloads per item prompt timing', () => {
    assert.deepEqual(buildSkipItemPromptPayload('before_roll', 1), { skipBeforeRollItem: true });
    assert.deepEqual(buildSkipItemPromptPayload('after_roll', 2), { skipAfterRollItem: true, rollStackIndex: 2 });
    assert.deepEqual(buildSkipItemPromptPayload('after_move', null), { skipAfterMoveItem: true });
  });

  it('keeps the existing deadline transition for skipped prompts', () => {
    assert.equal(getSkippedItemPromptNextDeadlineKind('before_roll'), 'roll');
    assert.equal(getSkippedItemPromptNextDeadlineKind('after_roll'), 'move');
    assert.equal(getSkippedItemPromptNextDeadlineKind('after_move'), 'after_move_turn_advance');
  });

  it('accepts item prompt results only for the room that submitted the request', () => {
    assert.equal(isCurrentItemPromptRequestRoom('room-a', 'room-a'), true);
    assert.equal(isCurrentItemPromptRequestRoom('room-a', 'room-b'), false);
    assert.equal(isCurrentItemPromptRequestRoom('', ''), false);
  });
});
