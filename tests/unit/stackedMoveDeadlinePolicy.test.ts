import assert from 'node:assert/strict';
import test from 'node:test';
import { preserveRemainingStackMoveDeadline } from '../../src/features/room/services/stackedMoveDeadlinePolicy.js';

test('남은 누적 이동이 있으면 authoritative deadline kind를 move로 유지한다', () => {
  const patch = {
    rollStack: [{ result: 'back-do', move: -1 }],
    rollStackClosed: true,
    selectedRollStackIndex: 0,
    turnDeadlineAt: 12345,
    turnDeadlineKind: 'roll',
  };

  const normalized = preserveRemainingStackMoveDeadline(patch, {
    stackedRollMode: true,
    captured: false,
  });

  assert.equal(normalized.turnDeadlineKind, 'move');
  assert.equal(normalized.turnDeadlineAt, 12345);
  assert.deepEqual(normalized.rollStack, patch.rollStack);
});

test('스택 종료 또는 잡기 전이는 기존 deadline kind를 건드리지 않는다', () => {
  const completedPatch = {
    rollStack: [],
    rollStackClosed: false,
    turnDeadlineKind: 'roll',
  };
  assert.equal(
    preserveRemainingStackMoveDeadline(completedPatch, {
      stackedRollMode: true,
      captured: false,
    }),
    completedPatch,
  );

  const capturedPatch = {
    rollStack: [{ result: 'do', move: 1 }],
    rollStackClosed: true,
    turnDeadlineKind: 'roll',
  };
  assert.equal(
    preserveRemainingStackMoveDeadline(capturedPatch, {
      stackedRollMode: true,
      captured: true,
    }),
    capturedPatch,
  );
});
