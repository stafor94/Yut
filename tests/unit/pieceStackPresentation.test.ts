import assert from 'node:assert/strict';
import test from 'node:test';
import { getPieceStackLiftPx, resolvePieceStackOrder } from '../../src/features/game/logic/pieceStackPresentation.js';

test('새로 도착한 말은 기존 스택의 가장 위 순서로 배치한다', () => {
  assert.deepEqual(
    resolvePieceStackOrder(['piece-a', 'piece-b'], ['piece-a', 'piece-b', 'piece-c'], ['piece-c']),
    ['piece-a', 'piece-b', 'piece-c'],
  );
});

test('업혀서 함께 도착한 말 묶음은 기존 말보다 위에 순서를 유지한다', () => {
  assert.deepEqual(
    resolvePieceStackOrder(
      ['piece-a', 'piece-b', 'piece-c'],
      ['piece-a', 'piece-b', 'piece-c'],
      ['piece-a', 'piece-b'],
    ),
    ['piece-c', 'piece-a', 'piece-b'],
  );
});

test('스택에서 빠진 말은 제거하고 새 말은 도착 순서대로 추가한다', () => {
  assert.deepEqual(
    resolvePieceStackOrder(['piece-a', 'piece-b'], ['piece-b', 'piece-c']),
    ['piece-b', 'piece-c'],
  );
});

test('말 스택 위치 간격은 인덱스당 3px만 올린다', () => {
  assert.equal(getPieceStackLiftPx(0), 0);
  assert.equal(getPieceStackLiftPx(1), 3);
  assert.equal(getPieceStackLiftPx(3), 9);
});
