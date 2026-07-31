import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  registerTimeoutRollClientFallback,
  settleTimeoutRollClientFallback,
} from '../../src/features/room/services/timeoutRollClientFallback';

const pendingHookSource = readFileSync('src/app/hooks/usePendingRemoteActions.ts', 'utf8');
const deadlineAt = 1_700_000_010_000;

test('timeout fallback 후보는 active room·actor·authoritative deadline·화면 위치를 고정한다', () => {
  const originalWindow = globalThis.window;
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { localStorage: { getItem: () => 'room-1' } },
  });
  try {
    const candidate = registerTimeoutRollClientFallback('roll_yut:seat-1:local', 'seat-1', deadlineAt, 37.5);
    assert.deepEqual(candidate, {
      roomId: 'room-1',
      localClientMutationId: 'roll_yut:seat-1:local',
      actorId: 'seat-1',
      timeoutDeadlineAt: deadlineAt,
      timingPositionPercent: 37.5,
    });
    assert.equal(settleTimeoutRollClientFallback('roll_yut:seat-1:local'), candidate);
    assert.equal(settleTimeoutRollClientFallback('roll_yut:seat-1:local'), null);
  } finally {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: originalWindow,
    });
  }
});

test('pending hook은 화면의 동일 deadline·위치를 network grace fallback과 canonical timeout action에 연결한다', () => {
  assert.match(pendingHookSource, /timingMeter\?\.dataset\.timingDeadlineAt/);
  assert.match(pendingHookSource, /timingMeter\?\.dataset\.positionPercent/);
  assert.match(pendingHookSource, /registerPendingTimeoutRollCandidate\(candidate\.roomId, actionKey, actorId\)/);
  assert.match(pendingHookSource, /getTurnRecoveryDeadlineAt\(candidate\.timeoutDeadlineAt\) - Date\.now\(\)/);
  assert.match(pendingHookSource, /canonicalizeTimeoutRollAction\(candidate\.roomId/);
  assert.match(pendingHookSource, /timingPositionPercent: candidate\.timingPositionPercent/);
  assert.match(pendingHookSource, /rollTimingZone: getRollTimingZone\(candidate\.timingPositionPercent\)/);
  assert.match(pendingHookSource, /timeoutRecoveredBy: candidate\.actorId/);
  assert.match(pendingHookSource, /commitOnce\(\)\.catch\(\(\) => commitOnce\(\)\)/);
});
