import test from 'node:test';
import assert from 'node:assert/strict';
import {
  findFirstSelectableRollStackIndex,
  getRollStackSelectionAvailability,
  isRollStackIndexSelectable,
} from '../../src/game-core/rollStackSelection';

const backDo = { name: '빽도', steps: -1 } as const;
const doRoll = { name: '도', steps: 1 } as const;
const gaeRoll = { name: '개', steps: 2 } as const;

test('빽도와 일반 결과가 섞였고 판 위 말이 없으면 빽도만 선택할 수 없다', () => {
  assert.deepEqual(getRollStackSelectionAvailability({
    rollStack: [backDo, doRoll],
    hasBackDoMovablePiece: false,
  }), [false, true]);
  assert.deepEqual(getRollStackSelectionAvailability({
    rollStack: [backDo, backDo, gaeRoll],
    hasBackDoMovablePiece: false,
  }), [false, false, true]);
});

test('빽도로 움직일 수 있는 말이 있으면 혼합 스택도 모두 선택할 수 있다', () => {
  assert.deepEqual(getRollStackSelectionAvailability({
    rollStack: [backDo, doRoll],
    hasBackDoMovablePiece: true,
  }), [true, true]);
});

test('빽도만 있는 스택은 판 위 말이 없어도 기존 선택을 유지한다', () => {
  assert.deepEqual(getRollStackSelectionAvailability({
    rollStack: [backDo],
    hasBackDoMovablePiece: false,
  }), [true]);
  assert.deepEqual(getRollStackSelectionAvailability({
    rollStack: [backDo, backDo],
    hasBackDoMovablePiece: false,
  }), [true, true]);
});

test('빽도가 없는 스택은 기존처럼 모두 선택할 수 있다', () => {
  assert.deepEqual(getRollStackSelectionAvailability({
    rollStack: [doRoll, gaeRoll],
    hasBackDoMovablePiece: false,
  }), [true, true]);
});

test('선택 인덱스와 첫 선택 가능 결과를 같은 availability로 판정한다', () => {
  const availability = getRollStackSelectionAvailability({
    rollStack: [backDo, doRoll],
    hasBackDoMovablePiece: false,
  });
  assert.equal(isRollStackIndexSelectable(availability, 0), false);
  assert.equal(isRollStackIndexSelectable(availability, 1), true);
  assert.equal(isRollStackIndexSelectable(availability, -1), false);
  assert.equal(isRollStackIndexSelectable(availability, 2), false);
  assert.equal(findFirstSelectableRollStackIndex(availability), 1);
  assert.equal(findFirstSelectableRollStackIndex([false, false]), null);
});
