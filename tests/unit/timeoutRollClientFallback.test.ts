import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clearTimeoutRollClientFallbacks,
  registerTimeoutRollClientFallback,
  runWithTimeoutRollClientDeadline,
  setTimeoutRollClientRoomId,
  settleTimeoutRollClientFallback,
  subscribeTimeoutRollClientFallbacks,
} from '../../src/features/room/services/timeoutRollClientFallback';
import { makeTimeoutActionKey } from '../../src/features/room/services/timeoutResolvers';

const deadlineAt = 1_700_000_010_000;

test('timeout callback은 active room과 authoritative deadline을 fallback 후보로 고정한다', () => {
  const originalWindow = globalThis.window;
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { localStorage: { getItem: () => 'room-storage' } },
  });
  setTimeoutRollClientRoomId('');
  const events: string[] = [];
  const unsubscribe = subscribeTimeoutRollClientFallbacks({
    onRegistered: (candidate) => events.push(`registered:${candidate.localClientMutationId}`),
    onSettled: (candidate) => events.push(`settled:${candidate.localClientMutationId}`),
  });

  try {
    const candidate = runWithTimeoutRollClientDeadline(deadlineAt, () => (
      registerTimeoutRollClientFallback('roll_yut:seat-1:local', 'seat-1')
    ));
    assert.deepEqual(candidate, {
      roomId: 'room-storage',
      localClientMutationId: 'roll_yut:seat-1:local',
      actorId: 'seat-1',
      timeoutDeadlineAt: deadlineAt,
    });
    assert.equal(settleTimeoutRollClientFallback('roll_yut:seat-1:local'), candidate);
    assert.deepEqual(events, [
      'registered:roll_yut:seat-1:local',
      'settled:roll_yut:seat-1:local',
    ]);
  } finally {
    unsubscribe();
    clearTimeoutRollClientFallbacks('room-storage');
    setTimeoutRollClientRoomId('');
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: originalWindow,
    });
  }
});

test('move timeout action key는 기존 QA·진단 계약을 유지하고 roll key만 resolver version을 포함한다', () => {
  assert.equal(makeTimeoutActionKey({
    roomId: 'room-1',
    stage: 'move',
    actorId: 'seat-1',
    timeoutDeadlineAt: deadlineAt,
  }), `timeout:room-1:move:seat-1:${deadlineAt}`);
  assert.match(makeTimeoutActionKey({
    roomId: 'room-1',
    stage: 'roll',
    actorId: 'seat-1',
    timeoutDeadlineAt: deadlineAt,
  }), /^timeout:v1:room-1:/);
});
