import assert from 'node:assert/strict';
import test from 'node:test';
import { findRemoteConsumedItem, getRemovedItemTypes, snapshotOwnedItems } from '../../src/app/flows/remoteItemUseNotice.js';

test('같은 아이템을 여러 개 보유한 경우 한 개 감소를 정확히 감지한다', () => {
  assert.deepEqual(getRemovedItemTypes(['shield', 'shield', 'trap'], ['shield', 'trap']), ['shield']);
});

test('로컬 플레이어 소비는 상대 아이템 사용 알림 대상으로 처리하지 않는다', () => {
  const previous = snapshotOwnedItems(['me', 'other'], { me: ['reroll'], other: ['shield'] });
  const current = snapshotOwnedItems(['me', 'other'], { me: [], other: ['shield'] });

  assert.equal(findRemoteConsumedItem(['me', 'other'], 'me', previous, current), null);
});

test('상대 플레이어가 소비한 아이템과 좌석을 반환한다', () => {
  const previous = snapshotOwnedItems(['me', 'other'], { me: [], other: ['golden_yut', 'trap'] });
  const current = snapshotOwnedItems(['me', 'other'], { me: [], other: ['trap'] });

  assert.deepEqual(findRemoteConsumedItem(['me', 'other'], 'me', previous, current), {
    seatId: 'other',
    itemType: 'golden_yut',
  });
});

test('상대 보유 아이템이 늘어난 경우 사용으로 오인하지 않는다', () => {
  const previous = snapshotOwnedItems(['me', 'other'], { me: [], other: [] });
  const current = snapshotOwnedItems(['me', 'other'], { me: [], other: ['move_plus_one'] });

  assert.equal(findRemoteConsumedItem(['me', 'other'], 'me', previous, current), null);
});
