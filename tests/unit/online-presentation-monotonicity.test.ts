import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildAuthoritativeApplyWakeSnapshot,
  shouldApplyAuthoritativeWake,
} from '../../src/app/flows/authoritativeApplyWakeFlow';
import { createPresentationRevisionGate } from '../../src/app/flows/presentationRevision';
import { isTurnActionPresentationPending } from '../../src/app/flows/turnActionPresentationPolicy';

test('apply-wake는 이미 적용한 같은 sequence와 오래된 sequence를 다시 표시하지 않는다', () => {
  assert.equal(shouldApplyAuthoritativeWake({ roomMatches: true, appliedSequence: 12, lastAppliedSequence: 12, deferred: false }), false);
  assert.equal(shouldApplyAuthoritativeWake({ roomMatches: true, appliedSequence: 11, lastAppliedSequence: 12, deferred: false }), false);
  assert.equal(shouldApplyAuthoritativeWake({ roomMatches: true, appliedSequence: 13, lastAppliedSequence: 12, deferred: true }), false);
  assert.equal(shouldApplyAuthoritativeWake({ roomMatches: true, appliedSequence: 13, lastAppliedSequence: 12, deferred: false }), true);
});

test('apply-wake snapshot은 commit patch에 포함된 pieces를 최신 snapshot보다 우선한다', () => {
  const snapshot = buildAuthoritativeApplyWakeSnapshot(
    { sequence: 9, patch: { pieces: [{ id: 'piece-1', nodeId: 'n04', started: true }] } },
    { lastSequence: 8, pieces: [{ id: 'piece-1', nodeId: 'n01', started: false }] },
  );
  assert.equal(snapshot?.lastSequence, 9);
  assert.deepEqual(snapshot?.pieces, [{ id: 'piece-1', nodeId: 'n04', started: true }]);
});

test('이미 enqueue된 settlement는 최신 presentation revision이 아니면 실행할 수 없다', () => {
  const gate = createPresentationRevisionGate();
  const first = gate.issue();
  const second = gate.issue();
  assert.equal(gate.isCurrent(first), false);
  assert.equal(gate.isCurrent(second), true);
  gate.invalidate();
  assert.equal(gate.isCurrent(second), false);
});

test('roll 제출 후 authoritative 응답 대기 중에는 소비된 timer와 live meter를 숨긴다', () => {
  assert.equal(isTurnActionPresentationPending({ phase: 'roll', hasRoll: false, canRollNow: false, canSubmitTurnAction: true, rollResultHolding: false }), true);
  assert.equal(isTurnActionPresentationPending({ phase: 'roll', hasRoll: false, canRollNow: true, canSubmitTurnAction: false, rollResultHolding: false }), true);
  assert.equal(isTurnActionPresentationPending({ phase: 'roll', hasRoll: false, canRollNow: true, canSubmitTurnAction: true, rollResultHolding: false }), false);
  assert.equal(isTurnActionPresentationPending({ phase: 'move', hasRoll: true, canRollNow: false, canSubmitTurnAction: true, rollResultHolding: true }), true);
  assert.equal(isTurnActionPresentationPending({ phase: 'move', hasRoll: true, canRollNow: false, canSubmitTurnAction: true, rollResultHolding: false }), false);
});
