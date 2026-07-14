import assert from 'node:assert/strict';
import test from 'node:test';
import { createTurnOrderIntro, type TurnOrderSeat } from '../../src/app/flows/turnOrderFlow';
import { TURN_ORDER_PRESENTATION_PREPARE_MS, buildTurnOrderSlotReel, getTurnOrderSlotRevealDurationMs, getTurnOrderStoppedSlotCount } from '../../src/app/flows/turnOrderPresentation';

const order = [
  { seatId: 'player-a', label: '1P', name: '가람', color: '#d94a38' },
  { seatId: 'player-b', label: '2P', name: '나래', color: '#2f6b4f' },
  { seatId: 'player-c', label: '3P', name: '다온', color: '#3267b1' },
  { seatId: 'player-d', label: '4P', name: '라온', color: '#8055a5' },
];

test('순서 연출 시작 전 3초 준비 시간을 둔다', () => {
  assert.equal(TURN_ORDER_PRESENTATION_PREPARE_MS, 3000);
});

test('순서 공개 애니메이션은 초기 셔플을 2초 더 길게 계산한다', () => {
  assert.equal(getTurnOrderSlotRevealDurationMs(0), 0);
  assert.equal(getTurnOrderSlotRevealDurationMs(1), 4000);
  assert.equal(getTurnOrderSlotRevealDurationMs(2), 4550);
  assert.equal(getTurnOrderSlotRevealDurationMs(3), 5100);
  assert.equal(getTurnOrderSlotRevealDurationMs(4), 5650);
});

test('4초 초기 셔플 뒤 0.55초 간격으로 순서가 하나씩 공개된다', () => {
  assert.equal(getTurnOrderStoppedSlotCount(4, 3999), 0);
  assert.equal(getTurnOrderStoppedSlotCount(4, 4000), 1);
  assert.equal(getTurnOrderStoppedSlotCount(4, 4549), 1);
  assert.equal(getTurnOrderStoppedSlotCount(4, 4550), 2);
  assert.equal(getTurnOrderStoppedSlotCount(4, 5100), 3);
  assert.equal(getTurnOrderStoppedSlotCount(4, 5650), 4);
});

test('4인 순서 정하기는 준비와 공개 구간을 합쳐 기존보다 정확히 3초 길어진다', () => {
  const previousDurationMs = 2000 + 3650;
  const currentDurationMs = TURN_ORDER_PRESENTATION_PREPARE_MS + getTurnOrderSlotRevealDurationMs(order.length);
  assert.equal(currentDurationMs - previousDurationMs, 3000);
});

test('intro 타임스탬프에 준비 시간과 연장된 공개 시간을 함께 반영한다', () => {
  const seats: TurnOrderSeat[] = order.map((entry, index) => ({
    id: entry.seatId,
    label: entry.label,
    name: entry.name,
    color: entry.color,
    team: index % 2 === 0 ? '청팀' : '홍팀',
  }));
  const now = 10_000;
  const finalHoldMs = 2_000;
  const { slotUntil, intro } = createTurnOrderIntro(seats, {
    getSeatPieceColor: (seat) => seat.color,
    playMode: 'individual',
    finalHoldMs,
    now,
  });

  assert.equal(slotUntil, now + TURN_ORDER_PRESENTATION_PREPARE_MS + getTurnOrderSlotRevealDurationMs(seats.length));
  assert.equal(intro.readyAt, slotUntil + finalHoldMs);
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
