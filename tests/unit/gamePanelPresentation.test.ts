import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getOwnedItemsPresentation,
  publishOwnedItemsPresentation,
  subscribeOwnedItemsPresentation,
} from '../../src/app/flows/ownedItemsPresentation.js';
import {
  getRoomInfoCollapsed,
  resetRoomInfoCollapsed,
  subscribeRoomInfoPresentation,
  toggleRoomInfoCollapsed,
} from '../../src/app/flows/roomInfoPresentation.js';

test('일반전과 아이템전의 보유 아이템 표시 상태를 분리한다', () => {
  publishOwnedItemsPresentation([], false);
  let notifications = 0;
  const unsubscribe = subscribeOwnedItemsPresentation(() => {
    notifications += 1;
  });

  publishOwnedItemsPresentation(['reroll', 'shield', 'trap'], true);
  assert.deepEqual(getOwnedItemsPresentation(), {
    itemMode: true,
    items: ['reroll', 'shield', 'trap'],
  });
  assert.equal(notifications, 1);

  publishOwnedItemsPresentation(['reroll', 'shield', 'trap'], true);
  assert.equal(notifications, 1, '동일한 표시 상태는 중복 발행하지 않아야 한다');

  publishOwnedItemsPresentation([], false);
  assert.deepEqual(getOwnedItemsPresentation(), {
    itemMode: false,
    items: [],
  });
  assert.equal(notifications, 2);
  unsubscribe();
});

test('방 정보 접기 상태를 상단과 인게임 패널이 공유한다', () => {
  resetRoomInfoCollapsed();
  let notifications = 0;
  const unsubscribe = subscribeRoomInfoPresentation(() => {
    notifications += 1;
  });

  toggleRoomInfoCollapsed();
  assert.equal(getRoomInfoCollapsed(), true);
  assert.equal(notifications, 1);

  toggleRoomInfoCollapsed();
  assert.equal(getRoomInfoCollapsed(), false);
  assert.equal(notifications, 2);

  resetRoomInfoCollapsed();
  assert.equal(notifications, 2, '이미 펼쳐진 상태를 다시 초기화해도 중복 알림이 없어야 한다');
  unsubscribe();
});
