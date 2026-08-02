import assert from 'node:assert/strict';
import test from 'node:test';
import { getAuthoritativeSnapshot, primeAuthoritativeResultState } from '../../src/app/flows/authoritativeResultState';

test('commit stateAfter는 비동기 App 적용이 끝나기 전에 controller 캐시에 동기 반영된다', () => {
  const cachedState = {
    lastSequence: 3,
    turnVersion: 7,
    roll: null,
    turnDeadlineKind: 'roll',
    pieces: [],
  };
  const moveReadyState = {
    lastSequence: 4,
    turnVersion: 8,
    roll: { name: '걸', steps: 3, bonus: false },
    turnDeadlineKind: 'move',
    pieces: [],
  };
  let assignedState = cachedState;

  const primedState = primeAuthoritativeResultState(
    { status: 'committed', sequence: 4, stateAfter: moveReadyState },
    cachedState,
    (state) => { assignedState = state as typeof cachedState; },
  );

  assert.equal(primedState, moveReadyState);
  assert.equal(assignedState, moveReadyState);
  assert.equal(assignedState.lastSequence, 4);
  assert.deepEqual(assignedState.roll, { name: '걸', steps: 3, bonus: false });
  assert.equal(assignedState.turnDeadlineKind, 'move');
});

test('patch 결과는 현재 캐시를 유지하며 필요한 필드만 동기 갱신한다', () => {
  const cachedState = {
    lastSequence: 4,
    turnVersion: 8,
    roll: { name: '걸', steps: 3, bonus: false },
    turnDeadlineKind: 'move',
    pieces: [{ id: 'piece-1', nodeId: 'n01' }],
  };

  const resolved = getAuthoritativeSnapshot({
    patch: { turnVersion: 9, turnDeadlineKind: 'roll' },
  }, cachedState);

  assert.deepEqual(resolved, {
    ...cachedState,
    turnVersion: 9,
    turnDeadlineKind: 'roll',
  });
});

test('snapshot 정보가 없는 duplicate 결과는 기존 캐시를 유지한다', () => {
  const cachedState = {
    lastSequence: 4,
    turnVersion: 8,
    roll: { name: '걸', steps: 3, bonus: false },
    pieces: [],
  };
  let assignedState = null as typeof cachedState | null;

  const primedState = primeAuthoritativeResultState(
    { status: 'duplicate', sequence: 4 },
    cachedState,
    (state) => { assignedState = state as typeof cachedState; },
  );

  assert.equal(primedState, cachedState);
  assert.equal(assignedState, cachedState);
});
