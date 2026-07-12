import assert from 'node:assert/strict';
import test from 'node:test';
import type { BoardPiece } from '../../src/features/game/components/GameBoard';
import { getMovePreviewNodeIds } from '../../src/app/appUtils';
import { FINISH_NODE_ID, getMovePathNodeIds, getMovePathNodeIdsWithPrevious } from '../../src/game-core/board/board';
import { reduceMoveCommand, type EngineLog, type EngineState } from '../../src/game-core/gameEngine';

const makeLog = (logs: EngineLog[], text: string): EngineLog => ({ id: logs.length + 1, text });

const makePiece = (overrides: Partial<BoardPiece> = {}): BoardPiece => ({
  id: 'p1',
  label: '1',
  ownerId: 'seat-1',
  color: '#000',
  nodeIndex: 18,
  nodeId: 'n19',
  started: true,
  finished: false,
  ...overrides,
});

const makeState = (): EngineState => ({
  pieces: [makePiece(), makePiece({ id: 'p2', ownerId: 'seat-2', nodeIndex: 0, nodeId: 'n01', started: false })],
  turnIndex: 0,
  turnOrderIds: ['seat-1', 'seat-2'],
  roll: { name: '걸', steps: 3 },
  logs: [],
  winner: '',
  trapNodes: [],
  shieldedPieceIds: [],
  branchChoice: 'outer',
  boardItems: [],
  ownedItems: {},
});

test('완주 경로는 출발점에서 끊고 이후 말판 칸을 포함하지 않는다', () => {
  assert.deepEqual(getMovePathNodeIds('n19', 3), ['n20', 'n01']);
});

test('완주 미리보기는 출발점에 완주 표식을 추가하고 이후 경로를 숨긴다', () => {
  assert.deepEqual(getMovePreviewNodeIds(makePiece(), { name: '걸', steps: 3 }, 'outer'), ['n20', 'n01', FINISH_NODE_ID]);
  assert.deepEqual(getMovePreviewNodeIds(makePiece(), { name: '개', steps: 2 }, 'outer'), ['n20', 'n01']);
});

test('출발점에 도착해 있던 말의 다음 양수 이동은 즉시 완주 경로가 된다', () => {
  assert.deepEqual(getMovePathNodeIdsWithPrevious('n01', 1, 'outer', 'n20'), [FINISH_NODE_ID]);
  assert.deepEqual(getMovePreviewNodeIds(makePiece({ nodeIndex: 0, nodeId: 'n01', previousNodeId: 'n20' }), { name: '도', steps: 1 }, 'outer'), ['n01', FINISH_NODE_ID]);
});

test('서버 이동 payload는 완주 뒤 말판 칸을 전달하지 않는다', () => {
  const result = reduceMoveCommand({
    state: makeState(),
    actorId: 'seat-1',
    pieceId: 'p1',
    branchChoice: 'outer',
    actorLogName: 'P1',
    playMode: 'individual',
    sides: [{ id: 'seat-1', team: '청팀' }, { id: 'seat-2', team: '홍팀' }],
    makeLog,
  });

  assert.equal(result.ok, true);
  if (!result.ok) throw new Error(result.message);
  assert.deepEqual(result.payload.pathNodeIds, ['n20', 'n01']);
  const movedPiece = (result.patch.pieces as EngineState['pieces']).find((piece) => piece.id === 'p1');
  assert.equal(movedPiece?.nodeId, FINISH_NODE_ID);
  assert.equal(movedPiece?.finished, true);
});
