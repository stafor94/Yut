import assert from 'node:assert/strict';
import test from 'node:test';
import {
  attachClientActionStartedAt,
  clearNextDeadlineAutoAction,
  markNextDeadlineAutoAction,
  shouldAttachClientActionStartedAt,
} from '../../src/features/room/services/turnActionStartedAtPolicy';

test('일반 사용자 turn action에는 enqueue 시각을 기록한다', () => {
  clearNextDeadlineAutoAction();
  const action = { type: 'move_piece', actorId: 'seat-1', payload: { clientActionId: 'move:seat-1:1' } };
  assert.equal(shouldAttachClientActionStartedAt(action), true);
  assert.deepEqual(attachClientActionStartedAt(action, 9_999), {
    ...action,
    payload: { ...action.payload, clientActionStartedAt: 9_999 },
  });
});

test('기존 시작 시각은 덮어쓰지 않는다', () => {
  clearNextDeadlineAutoAction();
  const action = { type: 'use_item', actorId: 'seat-1', payload: { clientActionId: 'use:seat-1:1', clientActionStartedAt: 8_888 } };
  assert.equal(attachClientActionStartedAt(action, 9_999), action);
});

test('제한시간 직전 자동 입력은 현재 deadline metadata와 함께 기록한다', () => {
  clearNextDeadlineAutoAction();
  assert.equal(markNextDeadlineAutoAction({ actionType: 'move_piece', actorId: 'seat-1', deadlineAt: 10_000, now: 9_900 }), true);
  const action = { type: 'move_piece', actorId: 'seat-1', payload: { clientActionId: 'move:seat-1:auto' } };
  assert.deepEqual(attachClientActionStartedAt(action, 9_920), {
    ...action,
    payload: {
      ...action.payload,
      clientActionStartedAt: 9_920,
      deadlineAutoSubmitted: true,
      autoSubmittedDeadlineAt: 10_000,
    },
  });
});

test('자동 입력 marker는 actor와 action type이 일치할 때만 소비한다', () => {
  clearNextDeadlineAutoAction();
  markNextDeadlineAutoAction({ actionType: 'use_item', actorId: 'seat-1', deadlineAt: 10_000, now: 9_900 });
  const wrongActor = { type: 'use_item', actorId: 'seat-2', payload: { clientActionId: 'use:seat-2:auto' } };
  const attached = attachClientActionStartedAt(wrongActor, 9_920);
  assert.equal(attached.payload?.deadlineAutoSubmitted, undefined);
  const nextAction = { type: 'use_item', actorId: 'seat-1', payload: { clientActionId: 'use:seat-1:next' } };
  assert.equal(attachClientActionStartedAt(nextAction, 9_930).payload?.deadlineAutoSubmitted, undefined);
});

test('timeout recovery와 자동 action에는 일반 입력 시작 시각을 붙이지 않는다', () => {
  clearNextDeadlineAutoAction();
  const timeoutAction = { type: 'roll_yut', payload: { clientActionId: 'timeout:room:roll:seat-1:1000', timedOut: true, timeoutDeadlineAt: 1_000 } };
  const coordinatorAction = { type: 'move_piece', payload: { clientActionId: 'move-ai', coordinatorSeatId: 'seat-2' } };
  const aiAction = { type: 'roll_yut', payload: { clientActionId: 'roll_yut_ai:seat-1:1' } };
  assert.equal(shouldAttachClientActionStartedAt(timeoutAction), false);
  assert.equal(shouldAttachClientActionStartedAt(coordinatorAction), false);
  assert.equal(shouldAttachClientActionStartedAt(aiAction), false);
  assert.equal(attachClientActionStartedAt(timeoutAction, 9_999), timeoutAction);
  assert.equal(attachClientActionStartedAt(coordinatorAction, 9_999), coordinatorAction);
  assert.equal(attachClientActionStartedAt(aiAction, 9_999), aiAction);
});

test('deadline과 무관한 action은 변경하지 않는다', () => {
  clearNextDeadlineAutoAction();
  const action = { type: 'continue_race', payload: { clientActionId: 'continue:seat-1' } };
  assert.equal(shouldAttachClientActionStartedAt(action), false);
  assert.equal(attachClientActionStartedAt(action, 9_999), action);
});
