import assert from 'node:assert/strict';
import test from 'node:test';
import { advanceSequenceFirstState } from '../../src/app/hooks/sequenceFirstGameState.js';
import {
  getGameConnectionPresentation,
  shouldRecoverGameConnectionOnResume,
} from '../../src/app/hooks/gameConnectionState.js';

test('연속 sequence patch는 snapshot 조회 없이 현재 상태에 적용한다', () => {
  const advanced = advanceSequenceFirstState({
    turnIndex: 0,
    logs: [],
    turnVersion: 4,
    lastSequence: 4,
    lastClientMutationId: '',
  }, [{
    id: '000000000005',
    sequence: 5,
    patch: { turnIndex: 1 },
    logEntries: [{ id: 5, text: '원격 액션' }],
    clientMutationId: 'remote-5',
  }]);

  assert.equal(advanced.status, 'applied');
  assert.equal(advanced.state.lastSequence, 5);
  assert.equal(advanced.state.turnIndex, 1);
  assert.equal(advanced.state.lastClientMutationId, 'remote-5');
});

test('sequence gap은 patch를 추측하지 않고 snapshot 복구를 요구한다', () => {
  const advanced = advanceSequenceFirstState({ lastSequence: 4 }, [{
    sequence: 6,
    patch: { turnIndex: 2 },
  }]);
  assert.equal(advanced.status, 'recovery-required');
  assert.equal(advanced.state?.lastSequence, 4);
});

test('연결 상태 표시는 복구 상태를 구분하고 오래된 서버 확인만 resume 복구한다', () => {
  assert.deepEqual(getGameConnectionPresentation({
    roomId: 'room-a',
    status: 'recovering',
    lastServerConfirmedAt: 0,
    hasPendingWrites: false,
  }), { label: '복구 중', tone: 'pending' });
  assert.equal(shouldRecoverGameConnectionOnResume({
    roomId: 'room-a',
    status: 'online',
    lastServerConfirmedAt: 99_000,
    hasPendingWrites: false,
  }, 'room-a', 100_000, 30_000), false);
  assert.equal(shouldRecoverGameConnectionOnResume({
    roomId: 'room-a',
    status: 'online',
    lastServerConfirmedAt: 60_000,
    hasPendingWrites: false,
  }, 'room-a', 100_000, 30_000), true);
});
