import assert from 'node:assert/strict';
import test from 'node:test';
import { getRollTimingZone } from '../../src/game-core/roll.js';
import {
  createRollTimingOpportunitySnapshotCache,
  getRollTimingInitialPositionPercentForDeadline,
  getRollTimingMotionState,
  getRollTimingOpportunityStateAt,
  sampleRollTimingInitialPositionPercent,
} from '../../src/game-core/rollTimingMotion.js';

test('fixed samplers map exactly to 0%, 15%, and 30% initial positions', () => {
  assert.equal(sampleRollTimingInitialPositionPercent(() => 0), 0);
  assert.equal(sampleRollTimingInitialPositionPercent(() => 0.5), 15);
  assert.equal(sampleRollTimingInitialPositionPercent(() => 1), 30);
  assert.equal(sampleRollTimingInitialPositionPercent(() => -1), 0);
  assert.equal(sampleRollTimingInitialPositionPercent(() => 2), 30);
});

test('one opportunity samples once across rerenders and a new deadline samples again', () => {
  const samples = [0.5, 1];
  let calls = 0;
  const cache = createRollTimingOpportunitySnapshotCache(() => {
    const value = samples[calls] ?? 0;
    calls += 1;
    return value;
  });

  const first = cache.get({ key: 'seat-1:roll:10_000', startedAt: 0, deadlineAt: 10_000 });
  const rerendered = cache.get({ key: 'seat-1:roll:10_000', startedAt: 0, deadlineAt: 10_000 });
  const onlineRefresh = cache.get({ key: 'seat-1:roll:10_000', startedAt: 0, deadlineAt: 10_000 });
  const next = cache.get({ key: 'seat-1:roll:20_000', startedAt: 10_000, deadlineAt: 20_000 });

  assert.strictEqual(rerendered, first);
  assert.strictEqual(onlineRefresh, first);
  assert.equal(first.initialPositionPercent, 15);
  assert.equal(next.initialPositionPercent, 30);
  assert.equal(calls, 2);
});

test('visible control and timeout recovery reuse one seed for the same authoritative timing window', () => {
  let calls = 0;
  const cache = createRollTimingOpportunitySnapshotCache(() => {
    calls += 1;
    return 0.5;
  });
  const visible = cache.get({
    key: 'room:seat-1:roll:11_000',
    startedAt: 1_000,
    deadlineAt: 11_000,
    initialPositionPercent: 30,
  });
  const recovery = cache.get({
    key: 'timeout:11_000:10_000',
    startedAt: 1_000,
    deadlineAt: 11_000,
  });

  assert.notStrictEqual(recovery, visible);
  assert.equal(recovery.initialPositionPercent, 30);
  assert.equal(recovery.initialPhaseMs, visible.initialPhaseMs);
  assert.equal(calls, 0);
});

test('the shared motion formula reverses at both ends and preserves the existing speed', () => {
  assert.deepEqual(getRollTimingMotionState({ initialPositionPercent: 30, elapsedMs: 0 }), {
    phaseMs: 300,
    positionPercent: 30,
  });
  assert.deepEqual(getRollTimingMotionState({ initialPositionPercent: 30, elapsedMs: 700 }), {
    phaseMs: 1000,
    positionPercent: 100,
  });
  assert.deepEqual(getRollTimingMotionState({ initialPositionPercent: 30, elapsedMs: 1700 }), {
    phaseMs: 0,
    positionPercent: 0,
  });
  assert.deepEqual(getRollTimingMotionState({ initialPositionPercent: 30, elapsedMs: 2400 }), {
    phaseMs: 700,
    positionPercent: 70,
  });
});

test('late mounting evaluates the current authoritative opportunity phase without restarting it', () => {
  const cache = createRollTimingOpportunitySnapshotCache(() => 0.5);
  const opportunity = cache.get({ key: 'seat-1:roll:11_000', startedAt: 1_000, deadlineAt: 11_000 });

  const lateMounted = getRollTimingOpportunityStateAt(opportunity, 4_000);
  const rerendered = getRollTimingOpportunityStateAt(opportunity, 4_000);

  assert.deepEqual(lateMounted, getRollTimingMotionState({ initialPositionPercent: 15, elapsedMs: 3_000 }));
  assert.deepEqual(rerendered, lateMounted);
});

test('deadline-seeded positions are stable across clients and vary across opportunities', () => {
  const first = getRollTimingInitialPositionPercentForDeadline(1_700_000_000_000);
  const repeated = getRollTimingInitialPositionPercentForDeadline(1_700_000_000_000);
  const next = getRollTimingInitialPositionPercentForDeadline(1_700_000_010_000);

  assert.equal(repeated, first);
  assert.ok(first >= 0 && first <= 30);
  assert.ok(next >= 0 && next <= 30);
  assert.notEqual(next, first);
});

test('manual and timeout judgments use the same position formula, and timeout is not fixed to Bad', () => {
  const manualPosition = getRollTimingMotionState({ initialPositionPercent: 15, elapsedMs: 300 }).positionPercent;
  assert.equal(manualPosition, 45);
  assert.equal(getRollTimingZone(manualPosition), 'perfect');

  const timeoutAtZero = getRollTimingMotionState({ initialPositionPercent: 0, elapsedMs: 10_000 }).positionPercent;
  const timeoutAtThirty = getRollTimingMotionState({ initialPositionPercent: 30, elapsedMs: 10_000 }).positionPercent;
  assert.equal(timeoutAtZero, 0);
  assert.equal(timeoutAtThirty, 30);
  assert.equal(getRollTimingZone(timeoutAtZero), 'bad');
  assert.equal(getRollTimingZone(timeoutAtThirty), 'good');
});
