import assert from 'node:assert/strict';
import test from 'node:test';
import { getMovePathNodeIds, getMovePathNodeIdsWithPrevious } from '../../src/game-core/board/board';
import { chooseAiRollTimingZone, getFallChanceForTimingZone, getRollTimingZone, rollYutResultWithTiming } from '../../src/game-core/roll';
import { reduceMoveCommand, reduceRollCommand, type EngineLog, type EngineState } from '../../src/game-core/gameEngine';
import { getRandomItemType } from '../../src/features/items/logic/items';
import { reduceAuthoritativeGameAction } from '../../src/features/room/services/roomAuthoritativeReducer';
import { getHumanSeatsWaitingForGameEntry, getOnlineGameCoordinatorSeatId, haveAllHumanSeatsEnteredGame } from '../../src/app/flows/onlineGameCoordinator';

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

test('중앙에서 빽도는 직전 칸으로 되돌아간다', () => {
  assert.deepEqual(getMovePathNodeIdsWithPrevious('c01', -1, 'outer', 'd02'), ['d02']);
  assert.deepEqual(getMovePathNodeIdsWithPrevious('c01', -1, 'outer', 'd03'), ['d03']);
  assert.deepEqual(getMovePathNodeIdsWithPrevious('c01', -1, 'outer', 'd06'), ['d06']);
  assert.deepEqual(getMovePathNodeIdsWithPrevious('c01', -1, 'outer', 'd07'), ['d07']);
});

test('직전 칸 정보가 없으면 중앙 빽도는 기존 역방향 경로를 사용한다', () => {
  assert.deepEqual(getMovePathNodeIdsWithPrevious('c01', -1, 'outer'), getMovePathNodeIds('c01', -1, 'outer'));
});


test('출발점의 말은 빽도에서 완주하지 않고 왼쪽 칸으로 이동한다', () => {
  const state = baseState();
  state.roll = { name: '빽도', steps: -1 };
  state.pieces = [
    { id: 'p1', ownerId: 'seat-1', nodeIndex: 0, nodeId: 'n01', started: true, finished: false },
    { id: 'p2', ownerId: 'seat-2', nodeIndex: 0, nodeId: 'n01', started: false, finished: false },
  ];

  const result = reduceMoveCommand({
    state,
    actorId: 'seat-1',
    pieceId: 'p1',
    branchChoice: 'outer',
    actorLogName: 'P1',
    playMode: 'individual',
    sides: [{ id: 'seat-1', team: '청팀' }, { id: 'seat-2', team: '홍팀' }],
    makeLog,
  });

  assert.equal(result.ok, true);
  const patch = result.patch as { pieces: EngineState['pieces']; turnIndex: number; roll: null };
  const moved = patch.pieces.find((piece) => piece.id === 'p1');
  assert.equal(moved?.started, true);
  assert.equal(moved?.finished, false);
  assert.equal(moved?.nodeId, 'n20');
  assert.equal(patch.turnIndex, 1);
  assert.equal(patch.roll, null);
});


test('출발 한 칸 위에서 빽도는 출발로 돌아가며 완주하지 않는다', () => {
  const state = baseState();
  state.roll = { name: '빽도', steps: -1 };
  state.pieces = [
    { id: 'p1', ownerId: 'seat-1', nodeIndex: 1, nodeId: 'n02', started: true, finished: false },
    { id: 'p2', ownerId: 'seat-2', nodeIndex: 0, nodeId: 'n01', started: false, finished: false },
  ];

  const result = reduceMoveCommand({
    state,
    actorId: 'seat-1',
    pieceId: 'p1',
    branchChoice: 'outer',
    actorLogName: 'P1',
    playMode: 'individual',
    sides: [{ id: 'seat-1', team: '청팀' }, { id: 'seat-2', team: '홍팀' }],
    makeLog,
  });

  assert.equal(result.ok, true);
  const patch = result.patch as { pieces: EngineState['pieces']; turnIndex: number; roll: null; logs: EngineLog[] };
  const moved = patch.pieces.find((piece) => piece.id === 'p1');
  assert.equal(moved?.started, true);
  assert.equal(moved?.finished, false);
  assert.equal(moved?.nodeId, 'n01');
  assert.equal(patch.turnIndex, 1);
  assert.equal(patch.roll, null);
  assert.equal(patch.logs.some((log) => log.text.includes('완주')), false);
});

test('중앙의 말은 빽도에서 저장된 직전 칸으로 이동한다', () => {
  const state = baseState();
  state.roll = { name: '빽도', steps: -1 };
  state.pieces = [
    { id: 'p1', ownerId: 'seat-1', nodeIndex: 22, nodeId: 'c01', previousNodeId: 'd02', started: true, finished: false },
    { id: 'p2', ownerId: 'seat-2', nodeIndex: 0, nodeId: 'n01', started: false, finished: false },
  ];

  const result = reduceMoveCommand({
    state,
    actorId: 'seat-1',
    pieceId: 'p1',
    branchChoice: 'outer',
    actorLogName: 'P1',
    playMode: 'individual',
    sides: [{ id: 'seat-1', team: '청팀' }, { id: 'seat-2', team: '홍팀' }],
    makeLog,
  });

  assert.equal(result.ok, true);
  const patch = result.patch as { pieces: EngineState['pieces']; turnIndex: number; roll: null };
  const moved = patch.pieces.find((piece) => piece.id === 'p1');
  assert.equal(moved?.nodeId, 'd02');
  assert.equal(moved?.previousNodeId, 'c01');
  assert.equal(patch.turnIndex, 1);
  assert.equal(patch.roll, null);
});

test('중앙의 말은 다른 진입 방향에서도 빽도에서 저장된 직전 칸으로 이동한다', () => {
  const state = baseState();
  state.roll = { name: '빽도', steps: -1 };
  state.pieces = [
    { id: 'p1', ownerId: 'seat-1', nodeIndex: 22, nodeId: 'c01', previousNodeId: 'd06', started: true, finished: false },
    { id: 'p2', ownerId: 'seat-2', nodeIndex: 0, nodeId: 'n01', started: false, finished: false },
  ];

  const result = reduceMoveCommand({
    state,
    actorId: 'seat-1',
    pieceId: 'p1',
    branchChoice: 'outer',
    actorLogName: 'P1',
    playMode: 'individual',
    sides: [{ id: 'seat-1', team: '청팀' }, { id: 'seat-2', team: '홍팀' }],
    makeLog,
  });

  assert.equal(result.ok, true);
  const patch = result.patch as { pieces: EngineState['pieces']; turnIndex: number; roll: null };
  const moved = patch.pieces.find((piece) => piece.id === 'p1');
  assert.equal(moved?.nodeId, 'd06');
  assert.equal(moved?.previousNodeId, 'c01');
  assert.equal(patch.turnIndex, 1);
  assert.equal(patch.roll, null);
});

test('중앙보다 한 칸 더 간 위치에서 빽도가 연속으로 나오면 중앙과 직전 칸을 왕복한다', () => {
  const state = baseState();
  state.roll = { name: '빽도', steps: -1 };
  state.pieces = [
    { id: 'p1', ownerId: 'seat-1', nodeIndex: 23, nodeId: 'd03', previousNodeId: 'c01', started: true, finished: false },
    { id: 'p2', ownerId: 'seat-2', nodeIndex: 0, nodeId: 'n01', started: false, finished: false },
  ];

  const firstBackDo = reduceMoveCommand({
    state,
    actorId: 'seat-1',
    pieceId: 'p1',
    branchChoice: 'outer',
    actorLogName: 'P1',
    playMode: 'individual',
    sides: [{ id: 'seat-1', team: '청팀' }, { id: 'seat-2', team: '홍팀' }],
    makeLog,
  });

  assert.equal(firstBackDo.ok, true);
  const firstPatch = firstBackDo.patch as { pieces: EngineState['pieces']; turnIndex: number; roll: null };
  const firstMoved = firstPatch.pieces.find((piece) => piece.id === 'p1');
  assert.equal(firstMoved?.nodeId, 'c01');
  assert.equal(firstMoved?.previousNodeId, 'd03');

  const secondState: EngineState = { ...state, pieces: firstPatch.pieces, roll: { name: '빽도', steps: -1 }, turnIndex: 0 };
  const secondBackDo = reduceMoveCommand({
    state: secondState,
    actorId: 'seat-1',
    pieceId: 'p1',
    branchChoice: 'outer',
    actorLogName: 'P1',
    playMode: 'individual',
    sides: [{ id: 'seat-1', team: '청팀' }, { id: 'seat-2', team: '홍팀' }],
    makeLog,
  });

  assert.equal(secondBackDo.ok, true);
  const secondPatch = secondBackDo.patch as { pieces: EngineState['pieces']; turnIndex: number; roll: null };
  const secondMoved = secondPatch.pieces.find((piece) => piece.id === 'p1');
  assert.equal(secondMoved?.nodeId, 'd03');
  assert.equal(secondMoved?.previousNodeId, 'c01');
});

test('아이템 랜덤 선택은 전달된 random 함수를 사용한다', () => {
  assert.equal(getRandomItemType(() => 0), 'reroll');
  assert.equal(getRandomItemType(() => 0.999), 'golden_yut');
});

test('온라인 게임 조율자는 방장 표시가 아니라 첫 번째 인간 좌석으로 결정된다', () => {
  const seats = [
    { id: 'host-user', isHost: true, isAI: true, isEmpty: false },
    { id: 'player-user', isHost: false, isAI: false, isEmpty: false },
    { id: 'empty-slot', isHost: false, isAI: false, isEmpty: true },
  ];

  assert.equal(getOnlineGameCoordinatorSeatId(seats), 'player-user');
});


test('게임 진입 확인은 AI를 기다리지 않고 현재 로컬 사람 좌석을 낙관적으로 진입 처리한다', () => {
  const seats = [
    { id: 'host-user', isAI: false, isEmpty: false, enteredStartVersion: 0 },
    { id: 'ai-user', isAI: true, isEmpty: false, enteredStartVersion: 0 },
  ];

  assert.equal(haveAllHumanSeatsEnteredGame(seats, 3, 'host-user'), true);
  assert.deepEqual(getHumanSeatsWaitingForGameEntry(seats, 3, 'host-user'), []);
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
    sides: [{ id: 'seat-1', team: '청팀' }, { id: 'seat-2', team: '홍팀' }],
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

test('완주 후 이어서 진행은 방장이 아닌 플레이어 actor도 커밋된다', () => {
  const state = {
    pieces: [
      { id: 'p1', ownerId: 'seat-1', nodeIndex: 0, nodeId: 'n01', started: true, finished: true },
      { id: 'p2', ownerId: 'seat-2', nodeIndex: 0, nodeId: 'n01', started: true, finished: false },
      { id: 'p3', ownerId: 'seat-3', nodeIndex: 0, nodeId: 'n01', started: true, finished: false },
    ],
    turnIndex: 0,
    turnOrderIds: ['seat-1', 'seat-2', 'seat-3'],
    initialTurnOrderIds: ['seat-1', 'seat-2', 'seat-3'],
    completedSeatIds: ['seat-1'],
    rankingSeatIds: ['seat-1'],
    gameEndMode: 'partial_finish' as const,
    lastFinishedSeatId: 'seat-1',
    continuationRound: 0,
    roll: null,
    boardItems: [],
    ownedItems: {},
    trapNodes: [],
    shieldedPieceIds: [],
    logs: [],
    winner: 'P1 승리',
    turnVersion: 1,
    lastSequence: 1,
  };

  const result = reduceAuthoritativeGameAction(
    state,
    { type: 'continue_race', actorId: 'seat-2', payload: { clientActionId: 'continue-race-non-host' } },
    { playMode: 'individual', pieceCount: 1 },
  );

  assert.equal(result.status, 'committed');
  assert.deepEqual(result.patch?.turnOrderIds, ['seat-2', 'seat-3']);
  assert.equal(result.patch?.winner, '');
  assert.equal(result.patch?.gameEndMode, '');
  assert.equal(result.patch?.continuationRound, 1);
});

test('윷 던지기 타이밍 구간은 중앙 Perfect와 좌우 Good을 판정한다', () => {
  assert.equal(getRollTimingZone(50), 'perfect');
  assert.equal(getRollTimingZone(40), 'good');
  assert.equal(getRollTimingZone(60), 'good');
  assert.equal(getRollTimingZone(20), 'normal');
});

test('AI 윷 던지기 타이밍은 30% Perfect, 40% Good, 30% Normal 기준으로 판정한다', () => {
  assert.equal(chooseAiRollTimingZone(() => 0.29), 'perfect');
  assert.equal(chooseAiRollTimingZone(() => 0.3), 'good');
  assert.equal(chooseAiRollTimingZone(() => 0.69), 'good');
  assert.equal(chooseAiRollTimingZone(() => 0.7), 'normal');
});

test('타이밍 구간별 낙 확률을 적용한다', () => {
  assert.equal(getFallChanceForTimingZone('perfect'), 0);
  assert.equal(getFallChanceForTimingZone('good'), 0.1);
  assert.equal(getFallChanceForTimingZone('normal'), 0.4);
});

test('Perfect 타이밍은 윷과 모 확률을 각각 5%p 올린다', () => {
  assert.equal(rollYutResultWithTiming('perfect', () => 0.78).result.name, '윷');
  assert.equal(rollYutResultWithTiming('perfect', () => 0.9).result.name, '모');
});

test('낙이 발생한 윷 던지기는 진행 기록을 남기고 턴을 넘긴다', () => {
  const result = reduceRollCommand({
    state: baseState(),
    actorId: 'seat-1',
    nextRoll: { name: '도', steps: 1 },
    actorLogName: 'P1',
    rollResultReadyAt: 123,
    makeLog,
    fallOccurred: true,
    timingZone: 'normal',
  });

  assert.equal(result.ok, true);
  const patch = result.patch as { roll: null; turnIndex: number; rollResultReadyAt: number; logs: EngineLog[]; fallEffect: unknown };
  assert.equal(patch.roll, null);
  assert.equal(patch.turnIndex, 1);
  assert.equal(patch.rollResultReadyAt, 0);
  assert.ok(patch.fallEffect);
  assert.match(patch.logs[0].text, /낙/);
});


test('잡기 이동은 일반 모드에서 턴을 유지하고 추가 던지기를 허용한다', () => {
  const state = baseState();
  state.roll = { name: '도', steps: 1 };
  state.pieces = [
    { id: 'p1', ownerId: 'seat-1', nodeIndex: 0, nodeId: 'n01', started: false, finished: false },
    { id: 'p2', ownerId: 'seat-2', nodeIndex: 1, nodeId: 'n02', started: true, finished: false },
  ];

  const result = reduceMoveCommand({
    state,
    actorId: 'seat-1',
    pieceId: 'p1',
    branchChoice: 'outer',
    actorLogName: 'P1',
    playMode: 'individual',
    sides: [{ id: 'seat-1', team: '청팀' }, { id: 'seat-2', team: '홍팀' }],
    makeLog,
  });

  assert.equal(result.ok, true);
  const patch = result.patch as { pieces: EngineState['pieces']; turnIndex: number; roll: null };
  const captured = patch.pieces.find((piece) => piece.id === 'p2');
  assert.equal(captured?.started, false);
  assert.equal(captured?.nodeId, 'n01');
  assert.equal(patch.turnIndex, 0);
  assert.equal(patch.roll, null);
  assert.equal(result.payload?.captured, true);
  assert.deepEqual(result.payload?.extraTurnReasons, ['capture']);
});

test('누적 던지기 모드는 윷/모 결과를 이동 스택에 쌓고 비보너스에서 선택 상태로 전환한다', () => {
  const first = reduceAuthoritativeGameAction(
    { ...baseState(), logs: [] },
    { type: 'roll_yut', actorId: 'seat-1', payload: { forcedResult: { name: '윷', steps: 4, bonus: true } } },
    { playMode: 'individual', pieceCount: 4, stackedRollMode: true },
  );

  assert.equal(first.status, 'committed');
  assert.deepEqual(first.patch?.roll, null);
  assert.deepEqual(first.patch?.rollStack, [{ name: '윷', steps: 4, bonus: true }]);
  assert.equal(first.patch?.rollStackClosed, false);

  const second = reduceAuthoritativeGameAction(
    { ...baseState(), roll: null, rollStack: first.patch?.rollStack, logs: [] },
    { type: 'roll_yut', actorId: 'seat-1', payload: { forcedResult: { name: '도', steps: 1 } } },
    { playMode: 'individual', pieceCount: 4, stackedRollMode: true },
  );

  assert.equal(second.status, 'committed');
  assert.deepEqual(second.patch?.roll, null);
  assert.deepEqual(second.patch?.rollStack, [{ name: '윷', steps: 4, bonus: true }, { name: '도', steps: 1 }]);
  assert.equal(second.patch?.rollStackClosed, true);
});

test('누적 이동 스택을 소비하면 남은 스택이 있을 때 턴을 유지하고 선택 대기 상태를 갱신한다', () => {
  const result = reduceAuthoritativeGameAction(
    {
      ...baseState(),
      roll: null,
      rollStack: [{ name: '윷', steps: 4, bonus: true }, { name: '도', steps: 1 }],
      rollStackClosed: true,
      selectedRollStackIndex: null,
      logs: [],
    },
    { type: 'move_piece', actorId: 'seat-1', payload: { pieceId: 'p1', branchChoice: 'outer', rollStackIndex: 1 } },
    { playMode: 'individual', pieceCount: 4, stackedRollMode: true },
    [{ id: 'seat-1', team: '청팀' }, { id: 'seat-2', team: '홍팀' }],
  );

  assert.equal(result.status, 'committed');
  assert.equal(result.patch?.turnIndex, 0);
  assert.deepEqual(result.patch?.rollStack, [{ name: '윷', steps: 4, bonus: true }]);
  assert.equal(result.patch?.selectedRollStackIndex, 0);
  assert.equal(result.patch?.rollStackClosed, true);
});


test('누적 던지기 모드에서 출발 전 말의 빽도 스택은 이동 없이 소비하고 턴을 넘긴다', () => {
  const result = reduceAuthoritativeGameAction(
    {
      ...baseState(),
      roll: null,
      rollStack: [{ name: '빽도', steps: -1 }],
      rollStackClosed: true,
      selectedRollStackIndex: 0,
      logs: [],
    },
    { type: 'move_piece', actorId: 'seat-1', payload: { pieceId: 'p1', branchChoice: 'outer', rollStackIndex: 0 } },
    { playMode: 'individual', pieceCount: 4, stackedRollMode: true },
    [{ id: 'seat-1', team: '청팀' }, { id: 'seat-2', team: '홍팀' }],
  );

  assert.equal(result.status, 'committed');
  assert.equal(result.patch?.turnIndex, 1);
  assert.deepEqual(result.patch?.rollStack, []);
  assert.equal(result.patch?.selectedRollStackIndex, null);
  assert.equal(result.patch?.rollStackClosed, false);
  assert.deepEqual(result.patch?.lastMovedPieceIds, []);
  assert.equal(result.payload?.skipped, true);
  const logs = result.patch?.logs as EngineLog[];
  assert.equal(logs.some((log) => log.text.includes('판 위에 나온 말이 없어 빽도를 이동하지 못합니다.')), true);
});


test('누적 던지기 모드에서 잡기 이동은 남은 스택을 보존한 채 추가 던지기 상태로 전환한다', () => {
  const result = reduceAuthoritativeGameAction(
    {
      ...baseState(),
      pieces: [
        { id: 'p1', ownerId: 'seat-1', nodeIndex: 0, nodeId: 'n01', started: false, finished: false },
        { id: 'p2', ownerId: 'seat-2', nodeIndex: 1, nodeId: 'n02', started: true, finished: false },
      ],
      roll: null,
      rollStack: [{ name: '도', steps: 1 }, { name: '개', steps: 2 }],
      rollStackClosed: true,
      selectedRollStackIndex: null,
      logs: [],
    },
    { type: 'move_piece', actorId: 'seat-1', payload: { pieceId: 'p1', branchChoice: 'outer', rollStackIndex: 0 } },
    { playMode: 'individual', pieceCount: 4, stackedRollMode: true },
    [{ id: 'seat-1', team: '청팀' }, { id: 'seat-2', team: '홍팀' }],
  );

  assert.equal(result.status, 'committed');
  assert.equal(result.patch?.turnIndex, 0);
  assert.deepEqual(result.patch?.rollStack, [{ name: '개', steps: 2 }]);
  assert.equal(result.patch?.selectedRollStackIndex, null);
  assert.equal(result.patch?.rollStackClosed, false);
  assert.equal(result.payload?.captured, true);
  assert.equal(result.payload?.extraTurn, true);
});
