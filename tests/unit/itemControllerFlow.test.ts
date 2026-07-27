import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import {
  buildSkipItemPromptPayload,
  getSkippedItemPromptNextDeadlineKind,
  hasPendingItemPromptChoiceLock,
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

  it('keeps before-roll, after-roll, and after-move choices locked while the matching pending action exists', () => {
    for (const timing of ['before_roll', 'after_roll', 'after_move'] as const) {
      const actionKey = `use_item:seat-1:${timing}`;
      const choice = { actionKey, timing, itemType: null };
      assert.equal(hasPendingItemPromptChoiceLock(choice, new Set([actionKey])), true);
      assert.equal(hasPendingItemPromptChoiceLock(choice, new Set()), false);
    }
  });

  it('does not treat a different pending action as the current prompt choice lock', () => {
    const choice = { actionKey: 'use_item:seat-1:skip-before', timing: 'before_roll' as const, itemType: null };
    assert.equal(hasPendingItemPromptChoiceLock(choice, new Set(['roll_yut:seat-1'])), false);
    assert.equal(hasPendingItemPromptChoiceLock(null, new Set([choice.actionKey])), false);
  });

  it('registers the pending choice and explicit turn lock before clearing the prompt', () => {
    const source = readFileSync('src/app/controllers/useItemController.ts', 'utf8');
    const choiceIndex = source.indexOf('params.setPendingItemPromptChoice(pendingChoice)');
    const lockIndex = source.indexOf('refreshPendingSkipLock(recovery)', choiceIndex);
    const promptClearIndex = source.indexOf('params.setItemPromptTiming(null)', lockIndex);

    assert.ok(choiceIndex >= 0);
    assert.ok(lockIndex > choiceIndex);
    assert.ok(promptClearIndex > lockIndex);
    assert.match(source, /blocksTurnActions: true/);
    assert.match(source, /const paramsRef = useRef\(params\);/);
    assert.match(source, /const currentParams = paramsRef\.current;/);
    assert.match(source, /PENDING_SKIP_RECOVERY_DELAY_MS/);
    assert.match(source, /refresh the creation time before any network work/i);
    assert.match(source, /commitQueuedAuthoritativeGameAction\(requestRoomId, action\)/);
    assert.match(source, /processed-action record is the authoritative proof/i);
    assert.match(source, /schedulePendingSkipRecovery\(recovery\)/);
    assert.match(source, /getQaUseItemActionDelayMs\(\)/);
  });

});
