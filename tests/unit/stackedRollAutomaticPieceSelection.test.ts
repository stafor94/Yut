import assert from 'node:assert/strict';
import test from 'node:test';
import type { BoardPiece } from '../../src/features/game/components/GameBoard';
import { getStackedRollAutomaticPiece } from '../../src/app/flows/stackedRollAutomaticPieceSelection';

const makePiece = (overrides: Partial<BoardPiece>): BoardPiece => ({
  id: 'piece-1',
  label: '말 1',
  ownerId: 'seat-1',
  color: '#000',
  nodeIndex: 0,
  nodeId: 'n01',
  started: false,
  finished: false,
  ...overrides,
});

const canControlPiece = (piece: BoardPiece) => piece.ownerId === 'seat-1';
const isSameSidePiece = (piece: BoardPiece, selectedPiece: BoardPiece) => piece.ownerId === selectedPiece.ownerId;

const getAutomaticPiece = (overrides: Partial<Parameters<typeof getStackedRollAutomaticPiece>[0]> = {}) => getStackedRollAutomaticPiece({
  pieces: [],
  selectedPieceId: '',
  rollStack: [
    { name: '윷', steps: 4, bonus: true },
    { name: '개', steps: 2 },
  ],
  selectedRollStackIndex: 0,
  rollStackClosed: true,
  isLocalTurn: true,
  canControlPiece,
  isSameSidePiece,
  ...overrides,
});

test('서로 다른 누적 결과는 결과 선택 전까지 말을 자동 선택하지 않는다', () => {
  const piece = makePiece({ id: 'seat-1-piece-1' });
  assert.equal(getAutomaticPiece({
    pieces: [piece],
    selectedRollStackIndex: null,
  }), undefined);
});

test('윷 결과를 선택하면 대기석의 가장 낮은 번호 말을 자동 선택한다', () => {
  const piece2 = makePiece({ id: 'seat-1-piece-2', label: '말 2' });
  const piece1 = makePiece({ id: 'seat-1-piece-1', label: '말 1' });
  const opponent = makePiece({ id: 'seat-2-piece-1', label: '상대 말 1', ownerId: 'seat-2' });

  assert.equal(getAutomaticPiece({
    pieces: [piece2, opponent, piece1],
    selectedRollStackIndex: 0,
  })?.id, piece1.id);
});

test('이미 선택한 판 위의 유효한 말은 누적 결과 선택 후에도 유지한다', () => {
  const selected = makePiece({ id: 'seat-1-piece-1', started: true, nodeId: 'n05', nodeIndex: 4 });
  const offBoard = makePiece({ id: 'seat-1-piece-2', label: '말 2' });

  assert.equal(getAutomaticPiece({
    pieces: [selected, offBoard],
    selectedPieceId: selected.id,
    selectedRollStackIndex: 1,
  })?.id, selected.id);
});

test('빽도는 판 위에 나온 말만 자동 선택하고 없으면 선택하지 않는다', () => {
  const offBoard = makePiece({ id: 'seat-1-piece-1' });
  const onBoard = makePiece({ id: 'seat-1-piece-2', label: '말 2', started: true, nodeId: 'n05', nodeIndex: 4 });
  const backDoStack = [{ name: '빽도' as const, steps: -1 }, { name: '개' as const, steps: 2 }];

  assert.equal(getAutomaticPiece({
    pieces: [offBoard],
    rollStack: backDoStack,
    selectedRollStackIndex: 0,
  }), undefined);
  assert.equal(getAutomaticPiece({
    pieces: [offBoard, onBoard],
    rollStack: backDoStack,
    selectedRollStackIndex: 0,
  })?.id, onBoard.id);
});

test('내 차례가 아니거나 누적 스택이 닫히지 않았으면 자동 선택하지 않는다', () => {
  const piece = makePiece({ id: 'seat-1-piece-1' });
  assert.equal(getAutomaticPiece({ pieces: [piece], isLocalTurn: false }), undefined);
  assert.equal(getAutomaticPiece({ pieces: [piece], rollStackClosed: false }), undefined);
});
