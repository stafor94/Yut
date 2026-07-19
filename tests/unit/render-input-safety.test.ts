import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ITEM_DEFINITIONS,
  ITEM_TIMING_LABELS,
  getItemDefinition,
  isItemType,
  type ItemType,
} from '../../src/features/items/logic/items';
import {
  readStoredBoolean,
  readStoredNumber,
  readStoredText,
  type PreferenceStorage,
} from '../../src/app/preferences/localPreferences';

test('keeps unknown persisted item keys from crashing render-time definition lookups', () => {
  const unknownItem = 'legacy_item' as ItemType;

  assert.equal(isItemType(unknownItem), false);
  assert.equal(getItemDefinition(unknownItem), null);
  assert.doesNotThrow(() => {
    const fallback = ITEM_DEFINITIONS[unknownItem];
    assert.equal(fallback.name, '알 수 없는 아이템');
    assert.equal(fallback.icon, '❓');
    assert.equal(ITEM_TIMING_LABELS[fallback.timing], undefined);
  });
});

test('uses preference fallbacks when browser storage access throws', () => {
  const blockedStorage: PreferenceStorage = {
    getItem() {
      throw new Error('storage blocked');
    },
  };

  assert.equal(readStoredText(blockedStorage, 'nickname', 'fallback'), 'fallback');
  assert.equal(readStoredBoolean(blockedStorage, 'enabled', true), true);
  assert.equal(readStoredNumber(blockedStorage, 'count', 4, [2, 3, 4] as const), 4);
});
