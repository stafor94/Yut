import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldPlayLocalTurnSound } from '../../src/app/flows/turnSound.js';

test('다른 플레이어 턴에서 내 턴으로 바뀔 때만 알림음을 재생한다', () => {
  assert.equal(shouldPlayLocalTurnSound({
    previousActiveSeatId: 'opponent',
    currentActiveSeatId: 'me',
    localSeatId: 'me',
  }), true);
});

test('최초 진입과 같은 플레이어의 roll 이동 단계에서는 재생하지 않는다', () => {
  assert.equal(shouldPlayLocalTurnSound({
    previousActiveSeatId: '',
    currentActiveSeatId: 'me',
    localSeatId: 'me',
  }), false);
  assert.equal(shouldPlayLocalTurnSound({
    previousActiveSeatId: 'me',
    currentActiveSeatId: 'me',
    localSeatId: 'me',
  }), false);
});

test('내 턴 종료와 상대 플레이어 사이 전환에서는 재생하지 않는다', () => {
  assert.equal(shouldPlayLocalTurnSound({
    previousActiveSeatId: 'me',
    currentActiveSeatId: 'opponent',
    localSeatId: 'me',
  }), false);
  assert.equal(shouldPlayLocalTurnSound({
    previousActiveSeatId: 'opponent-a',
    currentActiveSeatId: 'opponent-b',
    localSeatId: 'me',
  }), false);
});
