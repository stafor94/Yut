import assert from 'node:assert/strict';
import test from 'node:test';
import { getMovePathNodeIds } from '../../src/game-core/board/board';
import { reduceMoveCommand, reduceRollCommand, type EngineLog, type EngineState } from '../../src/game-core/gameEngine';
import { getRandomItemType } from '../../src/features/items/logic/items';

const makeLog = (logs: EngineLog[], text: string): EngineLog => ({ id: logs.length + 1, text });

const baseState = (): EngineState => ({
  pieces: [
    { id: 'p1', ownerId: 'seat-1', nodeIndex: 0, nodeId: 'n01', started: false, finished: false },
    { id: 'p2', ownerId: 'seat-2', nodeIndex: 0, nodeId: 'n01', started: false, finished: false },
  ],
  turnIndex: 0,
  turnOrderIds: ['seat-1', 'seat-2'],
  roll: null,
  logs: [],
  winner: '',
  trapNodes: [],
  shieldedPieceIds: [],
  branchChoice: 'outer',
  boardItems: [],
  ownedItems: {},
});

test('말판 지름길 경로는 분기 선택 시 중앙을 경유한다', () => {
  assert.deepEqual(getMovePathNodeIds('n06', 3, 'shortcut'), ['d05', 'd06', 'c01']);
});

test('중앙에서 외곽 선택 시 n16 방향 경로를 사용한다', () => {
  assert.deepEqual(getMovePathNodeIds('c01', 3, 'outer'), ['d07', 'd08', 'n16']);
});

test('아이템 랜덤 선택은 전달된 random 함수를 사용한다', () => {
  assert.equal(getRandomItemType(() => 0), 'reroll');
  assert.equal(getRandomItemType(() => 0.999), 'golden_yut');
});

test('차례가 아닌 플레이어의 윷 던지기는 거부된다', () => {
  const result = reduceRollCommand({
    state: baseState(),
    actorId: 'seat-2',
    nextRoll: { name: '도', steps: 1 },
    actorLogName: 'P2',
    rollResultReadyAt: 0,
    makeLog,
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'NOT_YOUR_TURN');
});

test('정상 윷 던지기는 roll과 로그 패치를 만든다', () => {
  const result = reduceRollCommand({
    state: baseState(),
    actorId: 'seat-1',
    nextRoll: { name: '도', steps: 1 },
    actorLogName: 'P1',
    rollResultReadyAt: 123,
    makeLog,
  });

  assert.equal(result.ok, true);
  const patch = result.patch as { roll: { name: string }; rollResultReadyAt: number; logs: EngineLog[] };
  assert.equal(patch.roll.name, '도');
  assert.equal(patch.rollResultReadyAt, 123);
  assert.match(patch.logs[0].text, /P1님이 도\(1칸\)/);
});

test('말 이동 reducer는 시작 전 말을 출발시키고 턴을 넘긴다', () => {
  const state = baseState();
  state.roll = { name: '개', steps: 2 };

  const result = reduceMoveCommand({
    state,
    actorId: 'seat-1',
    pieceId: 'p1',
    branchChoice: 'outer',
    actorLogName: 'P1',
    playMode: 'individual',
    sides: [{ id: 'seat-1' }, { id: 'seat-2' }],
    makeLog,
  });

  assert.equal(result.ok, true);
  const patch = result.patch as { pieces: EngineState['pieces']; turnIndex: number; roll: null };
  const moved = patch.pieces.find((piece) => piece.id === 'p1');
  assert.equal(moved?.started, true);
  assert.equal(moved?.nodeId, 'n03');
  assert.equal(patch.turnIndex, 1);
  assert.equal(patch.roll, null);
});
