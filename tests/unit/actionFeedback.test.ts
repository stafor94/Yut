import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyTurnActionFeedback,
  shouldClearActionErrorDialog,
  shouldOpenTurnActionErrorDialog,
} from '../../src/app/flows/actionFeedback.js';

test('pending local action과 애니메이션 진행은 정상 대기 상태다', () => {
  assert.equal(classifyTurnActionFeedback(['pending-local-remote-action']), 'status');
  assert.equal(classifyTurnActionFeedback(['moving-piece', 'processing-remote-action']), 'status');
  assert.equal(shouldOpenTurnActionErrorDialog('blocked', ['pending-local-remote-action']), false);
});

test('차례와 입력 안내 사유도 전체 화면 오류 modal을 열지 않는다', () => {
  assert.equal(classifyTurnActionFeedback(['not-local-turn']), 'recoverable');
  assert.equal(classifyTurnActionFeedback(['roll-already-exists']), 'recoverable');
  assert.equal(shouldOpenTurnActionErrorDialog('blocked', ['not-local-turn']), false);
});

test('실제 failure만 치명적 modal 대상이다', () => {
  assert.equal(shouldOpenTurnActionErrorDialog('failure', []), true);
  assert.equal(shouldOpenTurnActionErrorDialog('failure', ['pending-local-remote-action']), false);
  assert.equal(shouldOpenTurnActionErrorDialog('failure', ['unexpected-state']), true);
});

test('방, sequence, turn이 전진하면 남은 오류 modal을 해제한다', () => {
  const base = {
    dialogOpenedRoomId: 'room-a',
    currentRoomId: 'room-a',
    dialogOpenedSequence: 10,
    currentSequence: 10,
    dialogOpenedTurnIndex: 1,
    currentTurnIndex: 1,
  };
  assert.equal(shouldClearActionErrorDialog(base), false);
  assert.equal(shouldClearActionErrorDialog({ ...base, currentRoomId: 'room-b' }), true);
  assert.equal(shouldClearActionErrorDialog({ ...base, currentSequence: 11 }), true);
  assert.equal(shouldClearActionErrorDialog({ ...base, currentTurnIndex: 2 }), true);
});
