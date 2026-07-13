import assert from 'node:assert/strict';
import test from 'node:test';
import { TURN_ORDER_PRESENTATION_PREPARE_MS, buildTurnOrderSlotReel, getTurnOrderSlotRevealDurationMs, getTurnOrderStoppedSlotCount } from '../../src/app/flows/turnOrderPresentation';

const order = [
  { seatId: 'player-a', label: '1P', name: '가람', color: '#d94a38' },
  { seatId: 'player-b', label: '2P', name: '나래', color: '#2f6b4f' },
  { seatId: 'player-c', label: '3P', name: '다온', color: '#3267b1' },
  { seatId: 'player-d', label: '4P', name: '라온', color: '#8055a5' },
];

test('순서 연출은 인게임 진입 뒤 2초 준비 시간을 둔다', () => {
  assert.equal(TURN_ORDER_PRESENTATION_PREPARE_MS, 2000);
});

test('순서 공개 애니메이션은 기존보다 1초 길게 계산된다', () => {
  assert.equal(getTurnOrderSlotRevealDurationMs(0), 0);
  assert.equal(getTurnOrderSlotRevealDurationMs(1), 2000);
  assert.equal(getTurnOrderSlotRevealDurationMs(2), 2550);
  assert.equal(getTurnOrderSlotRevealDurationMs(3), 3100);
  assert.equal(getTurnOrderSlotRevealDurationMs(4), 3650);
});

test('2초 초기 셔플 뒤 0.55초 간격으로 순서가 하나씩 공개된다', () => {
  assert.equal(getTurnOrderStoppedSlotCount(4, 1999), 0);
  assert.equal(getTurnOrderStoppedSlotCount(4, 2000), 1);
  assert.equal(getTurnOrderStoppedSlotCount(4, 2549), 1);
  assert.equal(getTurnOrderStoppedSlotCount(4, 2550), 2);
  assert.equal(getTurnOrderStoppedSlotCount(4, 3100), 3);
  assert.equal(getTurnOrderStoppedSlotCount(4, 3650), 4);
});

test('각 슬롯 릴은 같은 순서 정보에서 항상 동일하게 생성된다', () => {
  const first = buildTurnOrderSlotReel(order, 2);
  const second = buildTurnOrderSlotReel(order, 2);
  assert.deepEqual(first, second);
  assert.equal(first.rows[first.targetRow].seatId, order[2].seatId);
});

test('서로 다른 순위 슬롯은 다른 릴 배열을 사용하면서 목표 플레이어에 정지한다', () => {
  const firstSlot = buildTurnOrderSlotReel(order, 0);
  const secondSlot = buildTurnOrderSlotReel(order, 1);
  assert.notDeepEqual(firstSlot.rows.map((entry) => entry.seatId), secondSlot.rows.map((entry) => entry.seatId));
  assert.equal(firstSlot.rows[firstSlot.targetRow].seatId, 'player-a');
  assert.equal(secondSlot.rows[secondSlot.targetRow].seatId, 'player-b');
});
