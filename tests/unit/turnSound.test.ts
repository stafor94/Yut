import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldPlayLocalTurnSound } from '../../src/app/flows/turnSound.js';

test('다른 플레이어 턴에서 내 턴으로 바뀔 때만 알림음을 재생한다', () => {
  assert.equal(shouldPlayLocalTurnSound({
    currentActiveSeatId: 'me',
    localSeatId: 'me',
    actionReady: true,
    alreadyPlayed: false,
  }), true);
});

test('첫 내 차례에도 행동 가능 시점에 한 번만 재생한다', () => {
  assert.equal(shouldPlayLocalTurnSound({
    currentActiveSeatId: 'me',
    localSeatId: 'me',
    actionReady: false,
    alreadyPlayed: false,
  }), false);
  assert.equal(shouldPlayLocalTurnSound({
    currentActiveSeatId: 'me',
    localSeatId: 'me',
    actionReady: true,
    alreadyPlayed: false,
  }), true);
  assert.equal(shouldPlayLocalTurnSound({
    currentActiveSeatId: 'me',
    localSeatId: 'me',
    actionReady: true,
    alreadyPlayed: true,
  }), false);
});

test('상대 플레이어 차례에는 행동 가능 상태여도 재생하지 않는다', () => {
  assert.equal(shouldPlayLocalTurnSound({
    currentActiveSeatId: 'opponent',
    localSeatId: 'me',
    actionReady: true,
    alreadyPlayed: false,
  }), false);
});
