import assert from 'node:assert/strict';
import test from 'node:test';
import { buildTurnOrderSlotReel, getTurnOrderSlotRevealDurationMs, getTurnOrderStoppedSlotCount } from '../../src/app/flows/turnOrderPresentation';

const order = [
  { seatId: 'player-a', label: '1P', name: '가람', color: '#d94a38' },
  { seatId: 'player-b', label: '2P', name: '나래', color: '#2f6b4f' },
  { seatId: 'player-c', label: '3P', name: '다온', color: '#3267b1' },
  { seatId: 'player-d', label: '4P', name: '라온', color: '#8055a5' },
];

test('순서 공개 시간은 인원별로 짧고 일정하게 계산된다', () => {
  assert.equal(getTurnOrderSlotRevealDurationMs(0), 0);
  assert.equal(getTurnOrderSlotRevealDurationMs(1), 1000);
  assert.equal(getTurnOrderSlotRevealDurationMs(2), 1550);
  assert.equal(getTurnOrderSlotRevealDurationMs(3), 2100);
  assert.equal(getTurnOrderSlotRevealDurationMs(4), 2650);
});

test('초기 셔플 뒤 0.55초 간격으로 순서가 하나씩 공개된다', () => {
  assert.equal(getTurnOrderStoppedSlotCount(4, 999), 0);
  assert.equal(getTurnOrderStoppedSlotCount(4, 1000), 1);
  assert.equal(getTurnOrderStoppedSlotCount(4, 1549), 1);
  assert.equal(getTurnOrderStoppedSlotCount(4, 1550), 2);
  assert.equal(getTurnOrderStoppedSlotCount(4, 2100), 3);
  assert.equal(getTurnOrderStoppedSlotCount(4, 2650), 4);
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
