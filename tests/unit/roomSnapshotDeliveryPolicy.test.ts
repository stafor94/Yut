import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldDeliverRoomSnapshot } from '../../src/features/room/services/roomSnapshotDeliveryPolicy';

test('캐시에 방 문서가 있으면 서버 확인 전에도 화면에 전달한다', () => {
  assert.equal(shouldDeliverRoomSnapshot(true, true), true);
});

test('캐시 miss는 방 종료로 전달하지 않고 서버가 부재를 확인한 뒤에만 전달한다', () => {
  assert.equal(shouldDeliverRoomSnapshot(false, true), false);
  assert.equal(shouldDeliverRoomSnapshot(false, false), true);
});
