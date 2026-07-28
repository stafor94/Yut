import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveEffectiveMoveContext } from '../../src/app/flows/effectiveMoveContext';
import { resolveMoveTimeoutContext } from '../../src/features/room/services/timeoutResolvers';

const rollStack = [
  { name: '도', steps: 1 } as const,
  { name: '걸', steps: 3 } as const,
];

test('다중 미선택 스택은 일반 이동에서는 선택 대기지만 timeout에서만 0번으로 결정된다', () => {
  const manual = resolveEffectiveMoveContext({
    stackedRollMode: true,
    roll: null,
    rollStack,
    rollStackClosed: true,
    selectedRollStackIndex: null,
  });
  assert.deepEqual(manual, {
    roll: null,
    rollStackIndex: null,
    steps: 0,
    fromStack: true,
  });

  const timedOut = resolveMoveTimeoutContext({
    stackedRollMode: true,
    roll: null,
    rollStack,
    rollStackClosed: true,
    selectedRollStackIndex: null,
  });
  assert.deepEqual(timedOut, {
    roll: rollStack[0],
    rollStackIndex: 0,
    steps: 1,
    reason: 'default-first',
  });
});

test('이미 선택된 스택 인덱스는 일반 이동과 timeout에서 동일하게 우선한다', () => {
  const manual = resolveEffectiveMoveContext({
    stackedRollMode: true,
    roll: null,
    rollStack,
    rollStackClosed: true,
    selectedRollStackIndex: 1,
  });
  assert.deepEqual(manual, {
    roll: rollStack[1],
    rollStackIndex: 1,
    steps: 3,
    fromStack: true,
  });

  const timedOut = resolveMoveTimeoutContext({
    stackedRollMode: true,
    roll: null,
    rollStack,
    rollStackClosed: true,
    selectedRollStackIndex: 1,
  });
  assert.deepEqual(timedOut, {
    roll: rollStack[1],
    rollStackIndex: 1,
    steps: 3,
    reason: 'selected',
  });
});
