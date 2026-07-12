import assert from 'node:assert/strict';
import test from 'node:test';
import { calculatePieceSelection, type PieceSelectionBoardPiece } from '../../src/app/flows/pieceSelection.js';

const piece = (id: string, label: string, ownerId: string, started = false, finished = false, nodeId = ''): PieceSelectionBoardPiece => ({
  id,
  label,
  ownerId,
  color: ownerId,
  nodeIndex: 0,
  nodeId,
  started,
  finished,
});

const select = (pieces: PieceSelectionBoardPiece[], selectedPieceId: string, moveSteps = 1) => calculatePieceSelection({
  pieces,
  selectedPieceId,
  hasMoveRoll: true,
  isLocalTurn: true,
  moveSteps,
  canControlPiece: (candidate) => candidate.ownerId === 'p1' || candidate.ownerId === 'p1-team',
  isSameSidePiece: (candidate, selected) => candidate.ownerId === selected.ownerId,
});

test('판 위 말이 있어도 높은 번호 출발 전 말을 누르면 제어 가능한 출발 전 말 전체를 선택 표시한다', () => {
  const pieces = [
    piece('p1-1', '1', 'p1', true, false, 'n3'),
    piece('p1-2', '2', 'p1'),
    piece('p1-10', '10', 'p1'),
  ];

  const result = select(pieces, 'p1-10');

  assert.deepEqual(result.selectedGroupPieceIds, ['p1-2', 'p1-10']);
});

test('출발 전 말 그룹의 실제 이동 대상은 항상 label 숫자 오름차순 첫 번째 말이다', () => {
  const pieces = [
    piece('p1-10', '10', 'p1'),
    piece('p1-2', '2', 'p1'),
    piece('p1-1', '1', 'p1'),
  ];

  const result = select(pieces, 'p1-10');

  assert.equal(result.pieceToMove?.id, 'p1-1');
});

test('상대편 말과 완주 말은 출발 전 선택 그룹에서 제외한다', () => {
  const pieces = [
    piece('p1-1', '1', 'p1'),
    piece('p1-2-finished', '2', 'p1', false, true),
    piece('p2-1', '1', 'p2'),
    piece('p1-team-1', '3', 'p1-team'),
  ];

  const result = select(pieces, 'p1-team-1');

  assert.deepEqual(result.selectedGroupPieceIds, ['p1-1', 'p1-team-1']);
  assert.equal(result.pieceToMove?.id, 'p1-1');
});

test('판 위 업힌 말 선택은 같은 위치의 같은 편 전체를 유지하고 빽도는 출발 전 말을 이동 대상으로 고르지 않는다', () => {
  const pieces = [
    piece('p1-1', '1', 'p1', true, false, 'n5'),
    piece('p1-2', '2', 'p1', true, false, 'n5'),
    piece('p1-3', '3', 'p1'),
    piece('p2-1', '1', 'p2', true, false, 'n5'),
  ];

  const stacked = select(pieces, 'p1-2');
  assert.deepEqual(stacked.selectedGroupPieceIds, ['p1-1', 'p1-2']);
  assert.equal(stacked.pieceToMove?.id, 'p1-2');

  const backDo = select(pieces, 'p1-3', -1);
  assert.deepEqual(backDo.selectedGroupPieceIds, ['p1-3']);
  assert.equal(backDo.pieceToMove?.id, 'p1-1');
});
