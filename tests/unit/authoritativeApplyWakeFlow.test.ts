import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAuthoritativeApplyWakeSnapshot } from '../../src/app/flows/authoritativeApplyWakeFlow.js';

test('wake snapshot은 최신 게임 시작 식별자를 보존하고 AI effect 의존 객체를 복제한다', () => {
  const latestSnapshot = {
    lastSequence: 10,
    startRequestVersion: 3,
    startRequestId: 'start-current',
    pieces: [{ id: 'piece-1', nodeId: 'start' }],
    gameSeats: [{ id: 'slot-2', isAI: true }],
    roll: null,
    rollStack: [],
  };
  const appliedValue = {
    lastSequence: 11,
    pieces: [{ id: 'piece-1', nodeId: 'n01' }],
    gameSeats: [{ id: 'slot-2', isAI: true }],
    roll: { name: '도', steps: 1 },
    rollStack: [{ name: '도', steps: 1 }],
  };

  const wakeSnapshot = buildAuthoritativeApplyWakeSnapshot(appliedValue, latestSnapshot) as unknown as Record<string, unknown>;

  assert.equal(wakeSnapshot.startRequestVersion, 3);
  assert.equal(wakeSnapshot.startRequestId, 'start-current');
  assert.equal(wakeSnapshot.lastSequence, 11);
  assert.notEqual(wakeSnapshot.pieces, appliedValue.pieces);
  assert.notEqual((wakeSnapshot.pieces as unknown[])[0], appliedValue.pieces[0]);
  assert.notEqual(wakeSnapshot.gameSeats, appliedValue.gameSeats);
  assert.notEqual(wakeSnapshot.roll, appliedValue.roll);
  assert.notEqual(wakeSnapshot.rollStack, appliedValue.rollStack);
});

test('wake snapshot은 authoritative 결과의 유효한 게임 시작 식별자를 우선한다', () => {
  const latestSnapshot = {
    lastSequence: 10,
    startRequestVersion: 3,
    startRequestId: 'start-old',
  };

  const wakeSnapshot = buildAuthoritativeApplyWakeSnapshot({
    lastSequence: 12,
    startRequestVersion: 4,
    startRequestId: 'start-new',
  }, latestSnapshot) as unknown as Record<string, unknown>;

  assert.equal(wakeSnapshot.startRequestVersion, 4);
  assert.equal(wakeSnapshot.startRequestId, 'start-new');
});

test('wake snapshot은 적용 결과가 객체가 아니면 생성하지 않는다', () => {
  assert.equal(buildAuthoritativeApplyWakeSnapshot(null, null), null);
  assert.equal(buildAuthoritativeApplyWakeSnapshot('invalid', null), null);
});
