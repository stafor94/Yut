import assert from 'node:assert/strict';
import test from 'node:test';
import {
  FINISH_NODE_ID,
  getMovePathNodeIds,
  getMovePathNodeIdsWithPrevious,
} from '../../src/game-core/board/board.js';
import {
  reduceMoveCommand,
  type EngineLog,
  type EngineState,
} from '../../src/game-core/gameEngine.js';

const makeLog = (logs: EngineLog[], text: string): EngineLog => ({
  id: Math.max(0, ...logs.map((log) => log.id)) + 1,
  text,
});

function makeState(nodeId: string, nodeIndex: number, steps: number): EngineState {
  return {
    pieces: [{
      id: 'piece-1',
      ownerId: 'seat-1',
      nodeIndex,
      nodeId,
      started: true,
      finished: false,
      previousNodeId: nodeId === 'n01' ? 'n20' : undefined,
    }],
    turnIndex: 0,
    turnOrderIds: ['seat-1', 'seat-2'],
    roll: { name: steps === 2 ? '개' : '걸', steps },
    logs: [],
    winner: '',
    trapNodes: [],
    shieldedPieceIds: [],
    boardItems: [],
    ownedItems: {},
  };
}

test('완주에 필요한 남은 칸이 있으면 실제 이동 경로에 n01 뒤 finish 단계를 포함한다', () => {
  assert.deepEqual(getMovePathNodeIdsWithPrevious('n19', 3), ['n20', 'n01', FINISH_NODE_ID]);
  assert.deepEqual(getMovePathNodeIdsWithPrevious('n20', 2), ['n01', FINISH_NODE_ID]);
  assert.deepEqual(getMovePathNodeIdsWithPrevious('d04', 2), ['n01', FINISH_NODE_ID]);
});

test('n01에 정확히 도착한 이동은 finish를 추가하지 않는다', () => {
  assert.deepEqual(getMovePathNodeIdsWithPrevious('n19', 2), ['n20', 'n01']);
  assert.deepEqual(getMovePathNodeIdsWithPrevious('n20', 1), ['n01']);
  assert.deepEqual(getMovePathNodeIdsWithPrevious('d04', 1), ['n01']);
});

test('말판 주변 탐색용 기본 경로에는 가상 finish 노드를 섞지 않는다', () => {
  assert.deepEqual(getMovePathNodeIds('n19', 3), ['n20', 'n01']);
  assert.deepEqual(getMovePathNodeIds('d04', 2), ['n01']);
});

test('한 바퀴를 돈 말이 n01에서 전진하면 finish로 이동한다', () => {
  assert.deepEqual(getMovePathNodeIdsWithPrevious('n01', 1, 'outer', 'n20'), [FINISH_NODE_ID]);
});

test('authoritative 이동 payload는 실제 완주 경로를 finish까지 기록한다', () => {
  const result = reduceMoveCommand({
    state: makeState('n19', 18, 3),
    actorId: 'seat-1',
    pieceId: 'piece-1',
    branchChoice: 'outer',
    actorLogName: '플레이어 1',
    playMode: 'individual',
    sides: [{ id: 'seat-1' }, { id: 'seat-2' }],
    makeLog,
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;

  const payload = result.payload as {
    pathNodeIds: string[];
    toNodeId: string;
    finishedMove: boolean;
  };
  const patch = result.patch as { pieces: EngineState['pieces'] };

  assert.deepEqual(payload.pathNodeIds, ['n20', 'n01', FINISH_NODE_ID]);
  assert.equal(payload.toNodeId, FINISH_NODE_ID);
  assert.equal(payload.finishedMove, true);
  assert.equal(patch.pieces[0]?.nodeId, FINISH_NODE_ID);
  assert.equal(patch.pieces[0]?.finished, true);
});

test('authoritative 이동은 n01에 정확히 도착하면 미완주 상태를 유지한다', () => {
  const result = reduceMoveCommand({
    state: makeState('n19', 18, 2),
    actorId: 'seat-1',
    pieceId: 'piece-1',
    branchChoice: 'outer',
    actorLogName: '플레이어 1',
    playMode: 'individual',
    sides: [{ id: 'seat-1' }, { id: 'seat-2' }],
    makeLog,
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;

  const payload = result.payload as {
    pathNodeIds: string[];
    toNodeId: string;
    finishedMove: boolean;
  };
  const patch = result.patch as { pieces: EngineState['pieces'] };

  assert.deepEqual(payload.pathNodeIds, ['n20', 'n01']);
  assert.equal(payload.toNodeId, 'n01');
  assert.equal(payload.finishedMove, false);
  assert.equal(patch.pieces[0]?.nodeId, 'n01');
  assert.equal(patch.pieces[0]?.finished, false);
});
