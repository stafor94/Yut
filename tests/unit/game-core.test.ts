import assert from 'node:assert/strict';
import test from 'node:test';
import { getAdjacentBoardNodeIds, getMovePathNodeIds, getMovePathNodeIdsWithPrevious } from '../../src/game-core/board/board';
import { chooseAiRollTimingZone, getFallChanceForTimingZone, getRollTimingZone, rollYutResultWithTiming } from '../../src/game-core/roll';
import { canRoll, getRollActionBlockReasons, reduceMoveCommand, reduceRollCommand, type EngineLog, type EngineState } from '../../src/game-core/gameEngine';
import { getRandomItemType } from '../../src/features/items/logic/items';
import { reduceAuthoritativeGameAction } from '../../src/features/room/services/roomAuthoritativeReducer';
import { TURN_NETWORK_GRACE_MS } from '../../src/features/room/services/roomTiming';
import { readFileSync } from 'node:fs';
import { getHumanSeatsWaitingForGameEntry, getOnlineGameCoordinatorSeatId, haveAllHumanSeatsEnteredGame } from '../../src/app/flows/onlineGameCoordinator';

const makeLog = (logs: EngineLog[], text: string): EngineLog => ({ id: logs.length + 1, text });

const withMockRandom = <T>(values: number[], callback: () => T): T => {
  const originalRandom = Math.random;
  let index = 0;
  Math.random = () => values[Math.min(index++, values.length - 1)] ?? 0.5;
  try {
    return callback();
  } finally {
    Math.random = originalRandom;
  }
};

const withMockNow = <T>(now: number, callback: () => T): T => {
  const originalNow = Date.now;
  Date.now = () => now;
  try {
    return callback();
  } finally {
    Date.now = originalNow;
  }
};

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


test('함정 설치 후보는 실제 말판 1칸 인접 노드를 방향과 무관하게 반환한다', () => {
  assert.deepEqual(getAdjacentBoardNodeIds('n03').sort(), ['n02', 'n04']);
  assert.deepEqual(getAdjacentBoardNodeIds('d06').sort(), ['c01', 'd05']);
  assert.deepEqual(getAdjacentBoardNodeIds('n06').sort(), ['d05', 'n05', 'n07']);
  assert.deepEqual(getAdjacentBoardNodeIds('n11').sort(), ['d01', 'n10', 'n12']);
  assert.deepEqual(getAdjacentBoardNodeIds('n16').sort(), ['d08', 'n15', 'n17']);
  assert.deepEqual(getAdjacentBoardNodeIds('c01').sort(), ['d02', 'd03', 'd06', 'd07']);
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

test('함정은 아군도 발동시키고 방패로 막을 수 없으며 아이템보다 먼저 처리된다', () => {
  const state = baseState();
  state.roll = { name: '개', steps: 2 };
  state.trapNodes = [{ nodeId: 'n03', ownerId: 'seat-1' }];
  state.shieldedPieceIds = ['p1'];
  state.boardItems = [{ id: 'item-1', type: 'reroll', nodeId: 'n03' }];

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
  const patch = result.patch as { pieces: EngineState['pieces']; trapNodes: EngineState['trapNodes']; shieldedPieceIds: string[]; boardItems: NonNullable<EngineState['boardItems']>; ownedItems: NonNullable<EngineState['ownedItems']> };
  const moved = patch.pieces.find((piece) => piece.id === 'p1');
  assert.equal(moved?.nodeId, 'n01');
  assert.equal(moved?.started, false);
  assert.deepEqual(patch.trapNodes, []);
  assert.deepEqual(patch.shieldedPieceIds, []);
  assert.deepEqual(patch.boardItems, [{ id: 'item-1', type: 'reroll', nodeId: 'n03' }]);
  assert.deepEqual(patch.ownedItems, {});
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

test('완주 후 이어서 진행은 이전 누적 던지기와 선택 대기를 다음 순위전에 넘기지 않는다', () => {
  const now = 1_700_000_000_000;
  const state = {
    pieces: [
      { id: 'p1', ownerId: 'seat-1', nodeIndex: 0, nodeId: 'n01', started: true, finished: true },
      { id: 'p2', ownerId: 'seat-2', nodeIndex: 0, nodeId: 'n01', started: true, finished: false },
      { id: 'p3', ownerId: 'seat-3', nodeIndex: 0, nodeId: 'n01', started: true, finished: false },
    ],
    turnIndex: 2,
    turnOrderIds: ['seat-1', 'seat-2', 'seat-3'],
    initialTurnOrderIds: ['seat-1', 'seat-2', 'seat-3'],
    completedSeatIds: ['seat-1'],
    rankingSeatIds: ['seat-1'],
    gameEndMode: 'partial_finish' as const,
    lastFinishedSeatId: 'seat-1',
    continuationRound: 0,
    roll: { name: '도', steps: 1 },
    rollStack: [{ name: '윷', steps: 4, bonus: true }, { name: '도', steps: 1 }],
    selectedRollStackIndex: 1,
    rollStackClosed: true,
    rollAnimation: { id: 'old-roll' },
    rollResultReadyAt: now + 1000,
    rollLockUntil: now + 2000,
    branchChoice: 'shortcut',
    pendingGoldenYutSelection: { actorId: 'seat-1', deadline: now + 3000 },
    pendingAfterMoveTurnIndex: 1,
    pendingTrapPlacement: { ownerId: 'seat-1', pieceId: 'p1', nodeIds: ['n02'], nextTurnIndex: 1, deadline: now + 4000 },
    itemPromptTiming: 'after_move' as const,
    lastMovedPieceIds: ['p1'],
    lastMovedSeatId: 'seat-1',
    lastRollTimingZone: 'perfect' as const,
    captureEffect: { id: 'capture-old' },
    trapEffect: { id: 'trap-old' },
    fallEffect: { id: 'fall-old' },
    boardItems: [{ id: 'item-1', type: 'reroll', nodeId: 'n03' }],
    ownedItems: { 'seat-2': ['reroll'] },
    trapNodes: [{ nodeId: 'n05', ownerId: 'seat-2' }],
    shieldedPieceIds: ['p2'],
    logs: [],
    winner: 'P1 승리',
    turnVersion: 1,
    lastSequence: 1,
  };

  const result = withMockNow(now, () => reduceAuthoritativeGameAction(
    state,
    { type: 'continue_race', actorId: 'seat-2', payload: { clientActionId: 'continue-race-reset-turn-state' } },
    { playMode: 'individual', pieceCount: 1, stackedRollMode: true },
  ));

  assert.equal(result.status, 'committed');
  assert.deepEqual(result.patch?.turnOrderIds, ['seat-2', 'seat-3']);
  assert.equal(result.patch?.turnIndex, 0);
  assert.equal(result.patch?.roll, null);
  assert.deepEqual(result.patch?.rollStack, []);
  assert.equal(result.patch?.selectedRollStackIndex, null);
  assert.equal(result.patch?.rollStackClosed, false);
  assert.equal(result.patch?.pendingGoldenYutSelection, null);
  assert.equal(result.patch?.pendingAfterMoveTurnIndex, null);
  assert.equal(result.patch?.pendingTrapPlacement, null);
  assert.equal(result.patch?.itemPromptTiming, null);
  assert.equal(result.patch?.turnDeadlineAt, now + 15000);
  assert.equal(result.patch?.turnDeadlineKind, 'roll');
  assert.equal(result.patch?.rollAnimation, null);
  assert.equal(result.patch?.rollResultReadyAt, 0);
  assert.equal(result.patch?.rollLockUntil, 0);
  assert.equal(result.patch?.branchChoice, 'outer');
  assert.deepEqual(result.patch?.lastMovedPieceIds, []);
  assert.equal(result.patch?.lastMovedSeatId, '');
  assert.equal(result.patch?.lastRollTimingZone, null);
  assert.equal(result.patch?.captureEffect, null);
  assert.equal(result.patch?.trapEffect, null);
  assert.equal(result.patch?.fallEffect, null);
  assert.equal(result.patch?.boardItems, undefined);
  assert.equal(result.patch?.ownedItems, undefined);
  assert.equal(result.patch?.trapNodes, undefined);
  assert.equal(result.patch?.shieldedPieceIds, undefined);
  assert.deepEqual(result.patch?.completedSeatIds, ['seat-1']);
  assert.deepEqual(result.patch?.initialTurnOrderIds, ['seat-1', 'seat-2', 'seat-3']);
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

test('아이템 사용 선택 중에는 윷 던지기를 차단한다', () => {
  const guardInput = {
    activeSeatId: 'seat-1',
    actorId: 'seat-1',
    roll: null,
    pendingItemPrompt: true,
    rollLocked: false,
    remoteActionClient: false,
    rollInProgress: false,
  };

  assert.equal(canRoll(guardInput), false);
  assert.deepEqual(getRollActionBlockReasons(guardInput), ['pending-item-prompt']);
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

test('누적 던지기 모드는 윷/모 결과를 이동 스택에 쌓고 비보너스에서 선택 상태로 전환한다', () => withMockRandom([0.8, 0.1], () => {
  const first = reduceAuthoritativeGameAction(
    { ...baseState(), logs: [] },
    { type: 'roll_yut', actorId: 'seat-1', payload: { rollTimingZone: 'perfect' } },
    { playMode: 'individual', pieceCount: 4, stackedRollMode: true },
  );

  assert.equal(first.status, 'committed');
  assert.deepEqual(first.patch?.roll, null);
  assert.deepEqual(first.patch?.rollStack, [{ name: '윷', steps: 4, bonus: true }]);
  assert.equal(first.patch?.rollStackClosed, false);

  const second = reduceAuthoritativeGameAction(
    { ...baseState(), roll: null, rollStack: first.patch?.rollStack as unknown[], logs: [] },
    { type: 'roll_yut', actorId: 'seat-1', payload: { rollTimingZone: 'perfect' } },
    { playMode: 'individual', pieceCount: 4, stackedRollMode: true },
  );

  assert.equal(second.status, 'committed');
  assert.deepEqual(second.patch?.roll, null);
  assert.deepEqual(second.patch?.rollStack, [{ name: '윷', steps: 4, bonus: true }, { name: '도', steps: 1 }]);
  assert.equal(second.patch?.rollStackClosed, true);
}));

test('온라인 일반 던지기 확정 payload는 서버 재생용 표시 결과와 낙 정보를 포함한다', () => withMockRandom([0.1], () => {
  const result = reduceAuthoritativeGameAction(
    { ...baseState(), logs: [] },
    { type: 'roll_yut', actorId: 'seat-1', payload: { rollTimingZone: 'perfect', clientActionId: 'local-roll' } },
    { playMode: 'individual', pieceCount: 4, stackedRollMode: false },
  );

  assert.equal(result.status, 'committed');
  assert.deepEqual(result.patch?.roll, { name: '도', steps: 1 });
  assert.deepEqual(result.payload?.displayRoll, { name: '도', steps: 1 });
  assert.equal(result.payload?.fallOccurred, false);
  assert.equal(result.payload?.fallCount, 0);
}));

test('온라인 상대·AI 던지기도 optimistic 없이 서버 sequence에서 한 번 재생할 표시 결과를 남긴다', () => withMockRandom([0.8], () => {
  const result = reduceAuthoritativeGameAction(
    { ...baseState(), turnIndex: 1, logs: [] },
    { type: 'roll_yut', actorId: 'seat-2', payload: { rollTimingZone: 'perfect', clientActionId: 'remote-ai-roll' } },
    { playMode: 'individual', pieceCount: 4, stackedRollMode: false },
  );

  assert.equal(result.status, 'committed');
  assert.deepEqual(result.patch?.roll, { name: '윷', steps: 4, bonus: true });
  assert.deepEqual(result.payload?.displayRoll, { name: '윷', steps: 4, bonus: true });
  assert.equal(result.payload?.fallOccurred, false);
  assert.equal(result.payload?.fallCount, 0);
}));

test('온라인 모아던지기 연속 결과는 stateAfter.roll이 없어도 payload displayRoll로 재생할 수 있게 남긴다', () => withMockRandom([0.8, 0.1], () => {
  const first = reduceAuthoritativeGameAction(
    { ...baseState(), logs: [] },
    { type: 'roll_yut', actorId: 'seat-1', payload: { rollTimingZone: 'perfect', stackedRollMode: true, clientActionId: 'stack-roll-1' } },
    { playMode: 'individual', pieceCount: 4, stackedRollMode: true },
  );
  const second = reduceAuthoritativeGameAction(
    { ...baseState(), roll: null, rollStack: first.patch?.rollStack as unknown[], rollStackClosed: first.patch?.rollStackClosed as boolean, logs: [] },
    { type: 'roll_yut', actorId: 'seat-1', payload: { rollTimingZone: 'perfect', stackedRollMode: true, clientActionId: 'stack-roll-2' } },
    { playMode: 'individual', pieceCount: 4, stackedRollMode: true },
  );

  assert.equal(first.status, 'committed');
  assert.deepEqual(first.patch?.roll, null);
  assert.deepEqual(first.payload?.displayRoll, { name: '윷', steps: 4, bonus: true });
  assert.equal(first.payload?.fallCount, 0);
  assert.equal(second.status, 'committed');
  assert.deepEqual(second.patch?.roll, null);
  assert.deepEqual(second.payload?.displayRoll, { name: '도', steps: 1 });
  assert.equal(second.payload?.fallCount, 0);
}));

test('온라인 낙 확정은 stateAfter.roll이 null이어도 payload displayRoll과 1~4 fallCount를 남긴다', () => withMockRandom([0.6, 0.6, 0.6, 0.6, 0, 0.5], () => {
  const result = reduceAuthoritativeGameAction(
    { ...baseState(), logs: [] },
    { type: 'roll_yut', actorId: 'seat-1', payload: { rollTimingZone: 'normal', clientActionId: 'fall-roll' } },
    { playMode: 'individual', pieceCount: 4, stackedRollMode: false },
  );

  assert.equal(result.status, 'committed');
  assert.deepEqual(result.patch?.roll, null);
  assert.deepEqual(result.payload?.displayRoll, { name: '모', steps: 5, bonus: true });
  assert.equal(result.payload?.fallOccurred, true);
  assert.equal(result.payload?.fallCount, 3);
}));

test('누적 던지기 모드는 시간초과 던지기로 이동 대기 상태가 되면 같은 턴 수동 던지기를 거부한다', () => withMockRandom([0.1], () => {
  const timeoutRoll = withMockNow(1000 + TURN_NETWORK_GRACE_MS + 1, () => reduceAuthoritativeGameAction(
    { ...baseState(), turnDeadlineKind: 'roll', turnDeadlineAt: 1000, logs: [] } as EngineState & { turnDeadlineKind: 'roll'; turnDeadlineAt: number },
    {
      type: 'roll_yut',
      actorId: 'seat-1',
      payload: {
        rollTimingZone: 'perfect',
        timedOut: true,
        timeoutRecoveredBy: 'roll_timeout',
        timeoutDeadlineAt: 1000,
      },
    },
    { playMode: 'individual', pieceCount: 4, stackedRollMode: true },
  ));

  assert.equal(timeoutRoll.status, 'committed');
  assert.deepEqual(timeoutRoll.patch?.rollStack, [{ name: '도', steps: 1 }]);
  assert.equal(timeoutRoll.patch?.rollStackClosed, true);
  assert.equal(timeoutRoll.patch?.turnDeadlineKind, 'move');

  const manualRoll = reduceAuthoritativeGameAction(
    {
      ...baseState(),
      roll: null,
      rollStack: timeoutRoll.patch?.rollStack,
      rollStackClosed: timeoutRoll.patch?.rollStackClosed as boolean,
      turnDeadlineKind: timeoutRoll.patch?.turnDeadlineKind as 'move',
      logs: timeoutRoll.patch?.logs as EngineLog[],
    },
    { type: 'roll_yut', actorId: 'seat-1', payload: { rollTimingZone: 'perfect' } },
    { playMode: 'individual', pieceCount: 4, stackedRollMode: true },
  );

  assert.equal(manualRoll.status, 'rejected');
  assert.equal(manualRoll.reason, '이미 윷을 던졌습니다. 말을 이동해주세요.');
}));

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

test('온라인 누적 이동은 열린 보너스 스택을 바로 소비하지 못한다', () => {
  const result = reduceAuthoritativeGameAction(
    {
      ...baseState(),
      roll: null,
      rollStack: [{ name: '윷', steps: 4, bonus: true }],
      rollStackClosed: false,
      selectedRollStackIndex: null,
      logs: [],
    },
    { type: 'move_piece', actorId: 'seat-1', payload: { pieceId: 'p1', branchChoice: 'outer', rollStackIndex: 0 } },
    { playMode: 'individual', pieceCount: 4, stackedRollMode: true },
    [{ id: 'seat-1', team: '청팀' }, { id: 'seat-2', team: '홍팀' }],
  );

  assert.equal(result.status, 'rejected');
  assert.equal(result.reason, '아직 추가 던지기가 남아 있습니다.');
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
    { type: 'move_piece', actorId: 'seat-1', payload: { pieceId: '', branchChoice: 'outer', rollStackIndex: 0 } },
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

test('누적 던지기 모드에서 빽도 뒤 도가 남으면 빽도만 소비하고 도 이동 상태를 유지한다', () => {
  const result = reduceAuthoritativeGameAction(
    {
      ...baseState(),
      roll: null,
      rollStack: [{ name: '빽도', steps: -1 }, { name: '도', steps: 1 }],
      rollStackClosed: true,
      selectedRollStackIndex: 0,
      logs: [],
    },
    { type: 'move_piece', actorId: 'seat-1', payload: { pieceId: '', branchChoice: 'outer', rollStackIndex: 0 } },
    { playMode: 'individual', pieceCount: 4, stackedRollMode: true },
    [{ id: 'seat-1', team: '청팀' }, { id: 'seat-2', team: '홍팀' }],
  );

  assert.equal(result.status, 'committed');
  assert.equal(result.patch?.turnIndex, 0);
  assert.deepEqual(result.patch?.rollStack, [{ name: '도', steps: 1 }]);
  assert.equal(result.patch?.selectedRollStackIndex, 0);
  assert.equal(result.patch?.rollStackClosed, true);
  assert.deepEqual(result.patch?.lastMovedPieceIds, []);
  assert.equal(result.payload?.skipped, true);
});

test('누적 던지기 모드에서 도 뒤 빽도는 빽도만 소비하고 도 이동 상태를 유지한다', () => {
  const result = reduceAuthoritativeGameAction(
    {
      ...baseState(),
      roll: null,
      rollStack: [{ name: '도', steps: 1 }, { name: '빽도', steps: -1 }],
      rollStackClosed: true,
      selectedRollStackIndex: 1,
      logs: [],
    },
    { type: 'move_piece', actorId: 'seat-1', payload: { pieceId: '', branchChoice: 'outer', rollStackIndex: 1 } },
    { playMode: 'individual', pieceCount: 4, stackedRollMode: true },
    [{ id: 'seat-1', team: '청팀' }, { id: 'seat-2', team: '홍팀' }],
  );

  assert.equal(result.status, 'committed');
  assert.equal(result.patch?.turnIndex, 0);
  assert.deepEqual(result.patch?.rollStack, [{ name: '도', steps: 1 }]);
  assert.equal(result.patch?.selectedRollStackIndex, 0);
  assert.equal(result.patch?.rollStackClosed, true);
  assert.deepEqual(result.patch?.lastMovedPieceIds, []);
  assert.equal(result.payload?.skipped, true);
});

test('빽도에서 이동 가능한 말이 있으면 잘못 선택한 출발 전 말은 에러로 거부한다', () => {
  const state = baseState();
  state.roll = { name: '빽도', steps: -1 };
  state.pieces = [
    { id: 'p1', ownerId: 'seat-1', nodeIndex: 0, nodeId: 'n01', started: false, finished: false },
    { id: 'p2', ownerId: 'seat-1', nodeIndex: 5, nodeId: 'n06', started: true, finished: false },
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

  assert.equal(result.ok, false);
  assert.equal(result.code, 'MOVABLE_PIECE_REQUIRED');
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



test('온라인 윷 던지기 성공 후 after_roll 아이템이 있으면 서버가 아이템 선택 대기를 연다', () => withMockRandom([0.1], () => {
  const result = reduceAuthoritativeGameAction(
    {
      ...baseState(),
      ownedItems: { 'seat-1': ['move_plus_one'] },
    },
    { type: 'roll_yut', actorId: 'seat-1', payload: { rollTimingZone: 'perfect' } },
    { playMode: 'individual', pieceCount: 4, stackedRollMode: false },
  );

  assert.equal(result.status, 'committed');
  assert.equal(result.patch?.itemPromptTiming, 'after_roll');
  assert.equal(result.patch?.turnDeadlineKind, 'item_prompt');
}));

test('온라인 after_roll 아이템 선택 대기 중에는 말 이동을 거부한다', () => {
  const result = reduceAuthoritativeGameAction(
    {
      ...baseState(),
      roll: { name: '도', steps: 1 },
      itemPromptTiming: 'after_roll',
    } as EngineState & { itemPromptTiming: 'after_roll' },
    { type: 'move_piece', actorId: 'seat-1', payload: { pieceId: 'p1', branchChoice: 'outer' } },
    { playMode: 'individual', pieceCount: 4, stackedRollMode: false },
  );

  assert.equal(result.status, 'rejected');
  assert.equal(result.reason, '아이템 사용 여부를 먼저 선택해주세요.');
});


test('온라인 after_roll 사용 안 함은 윷 결과를 유지하고 이동 단계로 전환한다', () => {
  const roll = { name: '걸', steps: 3 } as const;
  const state = {
    ...baseState(),
    turnIndex: 0,
    roll,
    rollStack: [roll],
    selectedRollStackIndex: 0,
    itemPromptTiming: 'after_roll',
    pendingAfterMoveTurnIndex: 1,
    logs: [],
  } as EngineState & { itemPromptTiming: 'after_roll'; rollStack: typeof roll[]; selectedRollStackIndex: number; pendingAfterMoveTurnIndex: number };

  const result = reduceAuthoritativeGameAction(
    state,
    { type: 'use_item', actorId: 'seat-1', payload: { skipAfterRollItem: true } },
    { playMode: 'individual', pieceCount: 4, stackedRollMode: true },
  );

  assert.equal(result.status, 'committed');
  assert.equal(result.patch?.itemPromptTiming, null);
  assert.equal(result.patch?.turnDeadlineKind, 'move');
  assert.equal(result.patch?.turnIndex, undefined);
  assert.equal(result.patch?.roll, undefined);
  assert.equal(result.patch?.rollStack, undefined);
  assert.equal(result.patch?.selectedRollStackIndex, undefined);
  assert.equal(result.patch?.pendingAfterMoveTurnIndex, undefined);
});

test('온라인 after_move 사용 안 함은 보류된 다음 턴으로 서버 턴을 진행한다', () => {
  const state = {
    ...baseState(),
    turnIndex: 0,
    lastMovedSeatId: 'seat-1',
    itemPromptTiming: 'after_move',
    pendingAfterMoveTurnIndex: 1,
    pendingTrapPlacement: { ownerId: 'seat-1' },
    logs: [],
  } as EngineState & { itemPromptTiming: 'after_move'; pendingAfterMoveTurnIndex: number; pendingTrapPlacement: unknown };

  const result = reduceAuthoritativeGameAction(
    state,
    { type: 'use_item', actorId: 'seat-1', payload: { skipAfterMoveItem: true } },
    { playMode: 'individual', pieceCount: 4, stackedRollMode: true },
  );

  assert.equal(result.status, 'committed');
  assert.equal(result.patch?.itemPromptTiming, null);
  assert.equal(result.patch?.pendingTrapPlacement, null);
  assert.equal(result.patch?.turnIndex, 1);
  assert.equal(result.patch?.pendingAfterMoveTurnIndex, null);
  assert.equal(result.patch?.turnDeadlineKind, 'roll');
});



test('온라인 roll timeout 복구는 deadline+grace 이후 deadline 일치 시만 커밋한다', () => {
  const deadline = 1000;
  const state = { ...baseState(), turnDeadlineKind: 'roll', turnDeadlineAt: deadline, logs: [] } as EngineState & { turnDeadlineKind: 'roll'; turnDeadlineAt: number };
  const early = withMockNow(deadline + TURN_NETWORK_GRACE_MS - 1, () => reduceAuthoritativeGameAction(
    state,
    { type: 'roll_yut', actorId: 'seat-1', payload: { rollTimingZone: 'normal', timedOut: true, timeoutDeadlineAt: deadline } },
    { playMode: 'individual', pieceCount: 4, stackedRollMode: false },
  ));
  const staleDeadline = withMockNow(deadline + TURN_NETWORK_GRACE_MS + 1, () => reduceAuthoritativeGameAction(
    state,
    { type: 'roll_yut', actorId: 'seat-1', payload: { rollTimingZone: 'normal', timedOut: true, timeoutDeadlineAt: deadline - 1 } },
    { playMode: 'individual', pieceCount: 4, stackedRollMode: false },
  ));
  const committed = withMockNow(deadline + TURN_NETWORK_GRACE_MS + 1, () => reduceAuthoritativeGameAction(
    state,
    { type: 'roll_yut', actorId: 'seat-1', payload: { rollTimingZone: 'normal', timedOut: true, timeoutDeadlineAt: deadline } },
    { playMode: 'individual', pieceCount: 4, stackedRollMode: false },
  ));

  assert.equal(early.status, 'rejected');
  assert.equal(staleDeadline.status, 'rejected');
  assert.equal(committed.status, 'committed');
});

test('온라인 move timeout 복구는 deadline+grace 이후 deadline 일치 시만 커밋한다', () => {
  const deadline = 1000;
  const state = {
    ...baseState(),
    roll: { name: '도', steps: 1 },
    turnDeadlineKind: 'move',
    turnDeadlineAt: deadline,
    logs: [],
  } as EngineState & { turnDeadlineKind: 'move'; turnDeadlineAt: number };
  const early = withMockNow(deadline + TURN_NETWORK_GRACE_MS - 1, () => reduceAuthoritativeGameAction(
    state,
    { type: 'move_piece', actorId: 'seat-1', payload: { pieceId: 'p1', timedOut: true, timeoutDeadlineAt: deadline } },
    { playMode: 'individual', pieceCount: 4, stackedRollMode: false },
  ));
  const committed = withMockNow(deadline + TURN_NETWORK_GRACE_MS + 1, () => reduceAuthoritativeGameAction(
    state,
    { type: 'move_piece', actorId: 'seat-1', payload: { pieceId: 'p1', timedOut: true, timeoutDeadlineAt: deadline } },
    { playMode: 'individual', pieceCount: 4, stackedRollMode: false },
  ));

  assert.equal(early.status, 'rejected');
  assert.equal(committed.status, 'committed');
});

test('온라인 아이템 timeout 복구는 deadline 전 조기 요청을 거부한다', () => {
  const result = reduceAuthoritativeGameAction(
    {
      ...baseState(),
      roll: { name: '도', steps: 1 },
      itemPromptTiming: 'after_roll',
      turnDeadlineKind: 'item_prompt',
      turnDeadlineAt: Date.now() + 10000,
    } as EngineState & { itemPromptTiming: 'after_roll'; turnDeadlineKind: 'item_prompt'; turnDeadlineAt: number },
    { type: 'use_item', actorId: 'seat-1', payload: { skipAfterRollItem: true, itemPromptTimeoutRecovery: true, timeoutDeadlineAt: Date.now() - TURN_NETWORK_GRACE_MS - 1 } },
    { playMode: 'individual', pieceCount: 4, stackedRollMode: false },
  );

  assert.equal(result.status, 'rejected');
  assert.equal(result.reason, '시간초과 대상 deadline이 아닙니다.');
});

test('온라인 아이템 timeout 복구는 프롬프트 대상 actor 불일치를 거부한다', () => {
  const result = reduceAuthoritativeGameAction(
    {
      ...baseState(),
      roll: { name: '도', steps: 1 },
      itemPromptTiming: 'after_roll',
      turnDeadlineKind: 'item_prompt',
      turnDeadlineAt: Date.now() - TURN_NETWORK_GRACE_MS - 1,
    } as EngineState & { itemPromptTiming: 'after_roll'; turnDeadlineKind: 'item_prompt'; turnDeadlineAt: number },
    { type: 'use_item', actorId: 'seat-2', payload: { skipAfterRollItem: true, itemPromptTimeoutRecovery: true, timeoutDeadlineAt: Date.now() - TURN_NETWORK_GRACE_MS - 1 } },
    { playMode: 'individual', pieceCount: 4, stackedRollMode: false },
  );

  assert.equal(result.status, 'rejected');
  assert.equal(result.reason, '아이템 선택 시간초과 대상이 아닙니다.');
});

test('온라인 coordinator 아이템 deadline 복구는 실제 actor skip으로 다음 단계에 진입한다', () => {
  const result = reduceAuthoritativeGameAction(
    {
      ...baseState(),
      roll: { name: '도', steps: 1 },
      itemPromptTiming: 'after_roll',
      turnDeadlineKind: 'item_prompt',
      turnDeadlineAt: Date.now() - TURN_NETWORK_GRACE_MS - 1,
    } as EngineState & { itemPromptTiming: 'after_roll'; turnDeadlineKind: 'item_prompt'; turnDeadlineAt: number },
    { type: 'use_item', actorId: 'seat-1', payload: { skipAfterRollItem: true, itemPromptTimeoutRecovery: true, timeoutDeadlineAt: Date.now() - TURN_NETWORK_GRACE_MS - 1 } },
    { playMode: 'individual', pieceCount: 4, stackedRollMode: false },
  );

  assert.equal(result.status, 'committed');
  assert.equal(result.patch?.itemPromptTiming, null);
  assert.equal(result.patch?.turnDeadlineKind, 'move');
});

test('온라인 after_move 선택 대기 중에는 이전 플레이어의 윷 던지기를 거부한다', () => {
  const result = reduceAuthoritativeGameAction(
    {
      ...baseState(),
      turnIndex: 0,
      lastMovedSeatId: 'seat-1',
      itemPromptTiming: 'after_move',
      pendingAfterMoveTurnIndex: 1,
      logs: [],
    } as EngineState & { itemPromptTiming: 'after_move'; pendingAfterMoveTurnIndex: number },
    { type: 'roll_yut', actorId: 'seat-1', payload: { rollTimingZone: 'perfect' } },
    { playMode: 'individual', pieceCount: 4, stackedRollMode: true },
  );

  assert.equal(result.status, 'rejected');
  assert.equal(result.reason, '아이템 사용 여부를 먼저 선택해주세요.');
});


test('온라인 누적 마지막 윷 이후 after_roll 팝업은 방금 추가한 스택을 선택한다', () => withMockRandom([0.1], () => {
  const result = reduceAuthoritativeGameAction(
    {
      ...baseState(),
      roll: null,
      rollStack: [{ name: '윷', steps: 4, bonus: true }],
      rollStackClosed: false,
      selectedRollStackIndex: null,
      ownedItems: { 'seat-1': ['reroll'] },
      logs: [],
    },
    { type: 'roll_yut', actorId: 'seat-1', payload: { rollTimingZone: 'perfect', stackedRollMode: true } },
    { playMode: 'individual', pieceCount: 4, stackedRollMode: true },
  );

  assert.equal(result.status, 'committed');
  assert.deepEqual(result.patch?.rollStack, [{ name: '윷', steps: 4, bonus: true }, { name: '도', steps: 1 }]);
  assert.equal(result.patch?.itemPromptTiming, 'after_roll');
  assert.equal(result.patch?.selectedRollStackIndex, 1);
}));

test('온라인 누적 다시 던지기는 선택된 이동 스택을 교체하고 append하지 않는다', () => withMockRandom([0.7], () => {
  const result = reduceAuthoritativeGameAction(
    {
      ...baseState(),
      roll: { name: '도', steps: 1 },
      rollStack: [{ name: '도', steps: 1 }, { name: '개', steps: 2 }],
      selectedRollStackIndex: 0,
      itemPromptTiming: 'after_roll',
      ownedItems: { 'seat-1': ['reroll'] },
      logs: [],
    },
    { type: 'use_item', actorId: 'seat-1', payload: { itemType: 'reroll', rollTimingZone: 'perfect', rollStackIndex: 0 } },
    { playMode: 'individual', pieceCount: 4, stackedRollMode: true },
  );

  assert.equal(result.status, 'committed');
  assert.deepEqual(result.patch?.rollStack, [{ name: '걸', steps: 3 }, { name: '개', steps: 2 }]);
  assert.deepEqual(result.patch?.roll, { name: '걸', steps: 3 });
  assert.equal(result.patch?.selectedRollStackIndex, 0);
  assert.deepEqual((result.patch?.ownedItems as Record<string, string[]>)['seat-1'], []);
}));


test('온라인 누적 다시 던지기는 payload가 없으면 authoritative 선택 스택을 교체하고 아이템 1개만 소비한다', () => withMockRandom([0.7], () => {
  const result = reduceAuthoritativeGameAction(
    {
      ...baseState(),
      roll: { name: '개', steps: 2 },
      rollStack: [{ name: '윷', steps: 4, bonus: true }, { name: '개', steps: 2 }],
      rollStackClosed: true,
      selectedRollStackIndex: 1,
      itemPromptTiming: 'after_roll',
      ownedItems: { 'seat-1': ['reroll', 'shield'] },
      logs: [],
    },
    { type: 'use_item', actorId: 'seat-1', payload: { itemType: 'reroll', rollTimingZone: 'perfect' } },
    { playMode: 'individual', pieceCount: 4, stackedRollMode: true },
  );

  assert.equal(result.status, 'committed');
  assert.deepEqual(result.patch?.rollStack, [{ name: '윷', steps: 4, bonus: true }, { name: '걸', steps: 3 }]);
  assert.deepEqual(result.patch?.roll, { name: '걸', steps: 3 });
  assert.equal(result.patch?.selectedRollStackIndex, 1);
  assert.deepEqual((result.patch?.ownedItems as Record<string, string[]>)['seat-1'], ['shield']);
  assert.equal(result.payload?.rollStackIndex, 1);
}));

test('온라인 이동값 변경 아이템은 서버에서 roll과 스택을 함께 갱신한다', () => {
  const roll = { name: '개', steps: 2 };
  const result = reduceAuthoritativeGameAction(
    {
      ...baseState(),
      roll,
      rollStack: [roll],
      selectedRollStackIndex: 0,
      itemPromptTiming: 'after_roll',
      ownedItems: { 'seat-1': ['move_plus_one'] },
      logs: [],
    },
    { type: 'use_item', actorId: 'seat-1', payload: { itemType: 'move_plus_one', rollStackIndex: 0 } },
    { playMode: 'individual', pieceCount: 4, stackedRollMode: true },
  );

  assert.equal(result.status, 'committed');
  assert.deepEqual(result.patch?.roll, { name: '개', steps: 3 });
  assert.deepEqual(result.patch?.rollStack, [{ name: '개', steps: 3 }]);
  assert.equal(result.patch?.itemPromptTiming, null);
  assert.equal(result.patch?.turnDeadlineKind, 'move');
  assert.deepEqual((result.patch?.ownedItems as Record<string, string[]>)['seat-1'], []);
});

test('온라인 방패 아이템은 서버에서 보호 대상과 다음 턴을 확정한다', () => {
  const result = reduceAuthoritativeGameAction(
    {
      ...baseState(),
      pieces: [
        { id: 'p1', ownerId: 'seat-1', nodeIndex: 2, nodeId: 'n03', started: true, finished: false },
        { id: 'p2', ownerId: 'seat-1', nodeIndex: 2, nodeId: 'n03', started: true, finished: false },
        { id: 'p3', ownerId: 'seat-2', nodeIndex: 0, nodeId: 'n01', started: false, finished: false },
      ],
      ownedItems: { 'seat-1': ['shield'] },
      lastMovedSeatId: 'seat-1',
      lastMovedPieceIds: ['p1'],
      itemPromptTiming: 'after_move',
      pendingAfterMoveTurnIndex: 1,
      logs: [],
    } as EngineState & { itemPromptTiming: 'after_move'; pendingAfterMoveTurnIndex: number },
    { type: 'use_item', actorId: 'seat-1', payload: { itemType: 'shield', pieceId: 'p1' } },
    { playMode: 'individual', pieceCount: 4, stackedRollMode: true },
  );

  assert.equal(result.status, 'committed');
  assert.deepEqual(result.patch?.shieldedPieceIds, ['p1', 'p2']);
  assert.equal(result.patch?.turnIndex, 1);
  assert.equal(result.patch?.pendingAfterMoveTurnIndex, null);
  assert.equal(result.patch?.turnDeadlineKind, 'roll');
});

test('온라인 황금 윷 아이템은 서버에서 보유 아이템을 소비한다', () => {
  const result = reduceAuthoritativeGameAction(
    {
      ...baseState(),
      ownedItems: { 'seat-1': ['golden_yut'] },
      itemPromptTiming: 'before_roll',
      logs: [],
    } as EngineState & { itemPromptTiming: 'before_roll' },
    { type: 'use_item', actorId: 'seat-1', payload: { itemType: 'golden_yut' } },
    { playMode: 'individual', pieceCount: 4, stackedRollMode: true },
  );

  assert.equal(result.status, 'committed');
  assert.deepEqual((result.patch?.ownedItems as Record<string, string[]>)['seat-1'], []);
  assert.equal(result.patch?.itemPromptTiming, null);
  assert.equal(result.patch?.turnDeadlineKind, 'roll');
});

test('온라인 before_roll 아이템 선택 대기 중에는 윷 던지기를 거부한다', () => {
  const result = reduceAuthoritativeGameAction(
    {
      ...baseState(),
      ownedItems: { 'seat-1': ['golden_yut'] },
      itemPromptTiming: 'before_roll',
      logs: [],
    } as EngineState & { itemPromptTiming: 'before_roll' },
    { type: 'roll_yut', actorId: 'seat-1', payload: { rollTimingZone: 'perfect' } },
    { playMode: 'individual', pieceCount: 4, stackedRollMode: false },
  );

  assert.equal(result.status, 'rejected');
  assert.equal(result.reason, '아이템 사용 여부를 먼저 선택해주세요.');
});

test('온라인 누적 AI 낙 후 다음 플레이어가 황금 윷을 보유하면 before_roll 선택 대기를 연다', () => withMockRandom([0.9, 0.9, 0.9, 0.9, 0], () => {
  const result = reduceAuthoritativeGameAction(
    {
      ...baseState(),
      ownedItems: { 'seat-2': ['golden_yut'] },
      logs: [],
    },
    { type: 'roll_yut', actorId: 'seat-1', payload: { rollTimingZone: 'normal' } },
    { playMode: 'individual', pieceCount: 4, stackedRollMode: true },
  );

  assert.equal(result.status, 'committed');
  assert.equal(result.payload?.fallOccurred, true);
  assert.equal(result.patch?.turnIndex, 1);
  assert.equal(result.patch?.itemPromptTiming, 'before_roll');
  assert.equal(result.patch?.turnDeadlineKind, 'item_prompt');
  assert.deepEqual(result.patch?.rollStack, []);
  assert.equal(result.patch?.selectedRollStackIndex, null);
  assert.equal(result.patch?.pendingGoldenYutSelection, null);
}));

test('온라인 누적 낙 후 다음 플레이어에게 before_roll 아이템이 없으면 roll 상태를 유지한다', () => withMockRandom([0.9, 0.9, 0.9, 0.9, 0], () => {
  const result = reduceAuthoritativeGameAction(
    {
      ...baseState(),
      ownedItems: {},
      logs: [],
    },
    { type: 'roll_yut', actorId: 'seat-1', payload: { rollTimingZone: 'normal' } },
    { playMode: 'individual', pieceCount: 4, stackedRollMode: true },
  );

  assert.equal(result.status, 'committed');
  assert.equal(result.payload?.fallOccurred, true);
  assert.equal(result.patch?.turnIndex, 1);
  assert.equal(result.patch?.itemPromptTiming, null);
  assert.equal(result.patch?.turnDeadlineKind, 'roll');
  assert.deepEqual(result.patch?.rollStack, []);
  assert.equal(result.patch?.selectedRollStackIndex, null);
  assert.equal(result.patch?.pendingGoldenYutSelection, null);
}));

test('온라인 빽도에서 판 위 말이 없으면 after_roll 아이템 선택 대기를 열지 않는다', () => withMockRandom([0.01], () => {
  const result = reduceAuthoritativeGameAction(
    {
      ...baseState(),
      pieces: [
        { id: 'p1', ownerId: 'seat-1', nodeIndex: 0, nodeId: 'n01', started: false, finished: false },
        { id: 'p2', ownerId: 'seat-2', nodeIndex: 0, nodeId: 'n01', started: false, finished: false },
      ],
      ownedItems: { 'seat-1': ['move_plus_one'] },
      logs: [],
    },
    { type: 'roll_yut', actorId: 'seat-1', payload: { rollTimingZone: 'perfect' } },
    { playMode: 'individual', pieceCount: 4, stackedRollMode: false },
  );

  assert.equal(result.status, 'committed');
  assert.equal(result.patch?.itemPromptTiming, null);
  assert.equal(result.patch?.turnDeadlineKind, 'move');
}));



test('온라인 함정 후보는 시작점과 모든 점유 칸을 제외한다', () => {
  const state = {
    ...baseState(),
    pieces: [
      { id: 'p1', ownerId: 'seat-1', nodeIndex: 5, nodeId: 'n06', started: true, finished: false },
      { id: 'p2', ownerId: 'seat-2', nodeIndex: 6, nodeId: 'n07', started: true, finished: false },
      { id: 'p3', ownerId: 'seat-2', nodeIndex: 0, nodeId: 'n01', started: true, finished: false },
    ],
    lastMovedSeatId: 'seat-1',
    lastMovedPieceIds: ['p1'],
    itemPromptTiming: 'after_move' as const,
    pendingAfterMoveTurnIndex: 1,
    ownedItems: { 'seat-1': ['trap'] },
    logs: [],
  } as EngineState & { itemPromptTiming: 'after_move'; pendingAfterMoveTurnIndex: number };

  const result = reduceAuthoritativeGameAction(
    state,
    { type: 'use_item', actorId: 'seat-1', payload: { itemType: 'trap', pieceId: 'p1' } },
    { playMode: 'individual', pieceCount: 4 },
  );

  assert.equal(result.status, 'committed');
  assert.deepEqual(result.patch?.pendingTrapPlacement, {
    ownerId: 'seat-1',
    pieceId: 'p1',
    nodeIds: ['n05', 'd05'],
    nextTurnIndex: 1,
    deadline: (result.patch?.pendingTrapPlacement as { deadline: number }).deadline,
  });
});

test('온라인 함정 설치는 후보 생성 뒤 점유된 칸이면 소비와 턴 진행 없이 거부한다', () => {
  const state = {
    ...baseState(),
    pieces: [
      { id: 'p1', ownerId: 'seat-1', nodeIndex: 5, nodeId: 'n06', started: true, finished: false },
      { id: 'p2', ownerId: 'seat-2', nodeIndex: 4, nodeId: 'n05', started: true, finished: false },
    ],
    turnIndex: 0,
    pendingTrapPlacement: { ownerId: 'seat-1', pieceId: 'p1', nodeIds: ['n05', 'n07', 'd05'], nextTurnIndex: 1, deadline: 1000 },
    itemPromptTiming: null,
    ownedItems: { 'seat-1': ['trap'] },
    trapNodes: [{ nodeId: 'n03', ownerId: 'seat-2' }],
    turnDeadlineAt: 1000,
    turnDeadlineKind: 'trap_placement' as const,
    logs: [],
  } as EngineState & { pendingTrapPlacement: unknown; turnDeadlineKind: 'trap_placement'; turnDeadlineAt: number };

  const result = reduceAuthoritativeGameAction(
    state,
    { type: 'place_trap', actorId: 'seat-1', payload: { pieceId: 'p1', nodeId: 'n05' } },
    { playMode: 'individual', pieceCount: 4 },
  );

  assert.equal(result.status, 'rejected');
  assert.equal(result.reason, '말이 있는 칸에는 함정을 설치할 수 없습니다.');
  assert.equal(result.patch, undefined);
  assert.deepEqual(state.ownedItems, { 'seat-1': ['trap'] });
  assert.deepEqual(state.trapNodes, [{ nodeId: 'n03', ownerId: 'seat-2' }]);
  assert.equal(state.turnIndex, 0);
  assert.equal(state.turnDeadlineAt, 1000);
});

test('온라인 누적 마지막 이동 후 함정은 lastMovedSeatId 기준으로 허용되고 place_trap 뒤 다음 턴으로 넘어간다', () => {
  const move = reduceAuthoritativeGameAction(
    {
      ...baseState(),
      pieces: [
        { id: 'p1', ownerId: 'seat-1', nodeIndex: 0, nodeId: 'n01', started: false, finished: false },
        { id: 'p2', ownerId: 'seat-2', nodeIndex: 0, nodeId: 'n01', started: false, finished: false },
      ],
      ownedItems: { 'seat-1': ['trap'] },
      roll: null,
      rollStack: [{ name: '개', steps: 2 }],
      rollStackClosed: true,
      logs: [],
    },
    { type: 'move_piece', actorId: 'seat-1', payload: { pieceId: 'p1', branchChoice: 'outer', rollStackIndex: 0 } },
    { playMode: 'individual', pieceCount: 4, stackedRollMode: true },
    [{ id: 'seat-1', team: '청팀' }, { id: 'seat-2', team: '홍팀' }],
  );

  assert.equal(move.status, 'committed');
  assert.equal(move.patch?.turnIndex, 0);
  assert.equal(move.patch?.itemPromptTiming, 'after_move');
  assert.equal(move.patch?.turnDeadlineKind, 'item_prompt');

  const useTrap = reduceAuthoritativeGameAction(
    {
      ...baseState(),
      pieces: move.patch?.pieces as EngineState['pieces'],
      turnIndex: move.patch?.turnIndex as number,
      ownedItems: { 'seat-1': ['trap'] },
      lastMovedSeatId: 'seat-1',
      lastMovedPieceIds: move.patch?.lastMovedPieceIds as string[],
      itemPromptTiming: move.patch?.itemPromptTiming,
      pendingAfterMoveTurnIndex: 1,
      logs: [],
    } as EngineState & { pendingAfterMoveTurnIndex: number },
    { type: 'use_item', actorId: 'seat-1', payload: { itemType: 'trap', pieceId: 'p1' } },
    { playMode: 'individual', pieceCount: 4, stackedRollMode: true },
    [{ id: 'seat-1', team: '청팀' }, { id: 'seat-2', team: '홍팀' }],
  );

  assert.equal(useTrap.status, 'committed');
  const placement = useTrap.patch?.pendingTrapPlacement as { nodeIds: string[]; nextTurnIndex: number };
  assert.equal(placement.nextTurnIndex, 1);
  assert.deepEqual([...placement.nodeIds].sort(), ['n02', 'n04']);

  const placeTrap = reduceAuthoritativeGameAction(
    {
      ...baseState(),
      pieces: move.patch?.pieces as EngineState['pieces'],
      turnIndex: 0,
      ownedItems: { 'seat-1': ['trap'] },
      pendingTrapPlacement: placement,
      logs: [],
    },
    { type: 'place_trap', actorId: 'seat-1', payload: { pieceId: 'p1', nodeId: 'n04' } },
    { playMode: 'individual', pieceCount: 4, stackedRollMode: true },
  );

  assert.equal(placeTrap.status, 'committed');
  assert.equal(placeTrap.patch?.turnIndex, 1);
  assert.deepEqual(placeTrap.patch?.trapNodes, [{ nodeId: 'n04', ownerId: 'seat-1' }]);
  assert.equal(placeTrap.patch?.pendingAfterMoveTurnIndex, null);
});

test('온라인 함정 설치는 place_trap에서 아이템을 소비하고 trapNodes를 유지 상태로 커밋한다', () => {
  const useTrap = reduceAuthoritativeGameAction(
    {
      ...baseState(),
      pieces: [
        { id: 'p1', ownerId: 'seat-1', nodeIndex: 2, nodeId: 'n03', started: true, finished: false },
        { id: 'p2', ownerId: 'seat-2', nodeIndex: 0, nodeId: 'n01', started: false, finished: false },
      ],
      ownedItems: { 'seat-1': ['trap'] },
      lastMovedSeatId: 'seat-1',
      lastMovedPieceIds: ['p1'],
      itemPromptTiming: 'after_move',
      pendingAfterMoveTurnIndex: 1,
      logs: [],
    } as EngineState & { itemPromptTiming: 'after_move'; pendingAfterMoveTurnIndex: number },
    { type: 'use_item', actorId: 'seat-1', payload: { itemType: 'trap', pieceId: 'p1' } },
    { playMode: 'individual', pieceCount: 4, stackedRollMode: true },
  );

  assert.equal(useTrap.status, 'committed');
  assert.deepEqual((useTrap.patch?.ownedItems as Record<string, string[]>)?.['seat-1'], undefined);
  const placement = useTrap.patch?.pendingTrapPlacement as { nodeIds: string[] };
  assert.deepEqual([...placement.nodeIds].sort(), ['n02', 'n04']);

  const placeTrap = reduceAuthoritativeGameAction(
    {
      ...baseState(),
      pieces: [
        { id: 'p1', ownerId: 'seat-1', nodeIndex: 2, nodeId: 'n03', started: true, finished: false },
        { id: 'p2', ownerId: 'seat-2', nodeIndex: 0, nodeId: 'n01', started: false, finished: false },
      ],
      ownedItems: { 'seat-1': ['trap'] },
      pendingTrapPlacement: useTrap.patch?.pendingTrapPlacement,
      logs: [],
    },
    { type: 'place_trap', actorId: 'seat-1', payload: { pieceId: 'p1', nodeId: 'n04' } },
    { playMode: 'individual', pieceCount: 4, stackedRollMode: true },
  );

  assert.equal(placeTrap.status, 'committed');
  assert.deepEqual(placeTrap.patch?.trapNodes, [{ nodeId: 'n04', ownerId: 'seat-1' }]);
  assert.equal(placeTrap.patch?.pendingTrapPlacement, null);
  assert.deepEqual((placeTrap.patch?.ownedItems as Record<string, string[]>)['seat-1'], []);
});


test('온라인 함정 설치 시간초과 취소는 서버에서 다음 턴으로 진행한다', () => {
  const placement = { ownerId: 'seat-1', pieceId: 'p1', nodeIds: ['n02'], nextTurnIndex: 1, deadline: 1000 };
  const state = {
    ...baseState(),
    turnIndex: 0,
    pendingTrapPlacement: placement,
    itemPromptTiming: null,
    pendingAfterMoveTurnIndex: 1,
    turnDeadlineKind: 'trap_placement',
    turnDeadlineAt: placement.deadline,
    logs: [],
  } as EngineState & { pendingTrapPlacement: unknown; pendingAfterMoveTurnIndex: number; turnDeadlineKind: 'trap_placement'; turnDeadlineAt: number };

  const result = withMockNow(1000 + TURN_NETWORK_GRACE_MS + 1, () => reduceAuthoritativeGameAction(
    state,
    { type: 'use_item', actorId: 'seat-1', payload: { cancelTrapPlacement: true, trapPlacementTimeoutRecovery: true, pieceId: 'p1', placementDeadline: placement.deadline, timeoutDeadlineAt: placement.deadline } },
    { playMode: 'individual', pieceCount: 4, stackedRollMode: true },
  ));

  assert.equal(result.status, 'committed');
  assert.equal(result.patch?.pendingTrapPlacement, null);
  assert.equal(result.patch?.itemPromptTiming, null);
  assert.equal(result.patch?.turnIndex, 1);
  assert.equal(result.patch?.pendingAfterMoveTurnIndex, null);
  assert.equal(result.patch?.turnDeadlineKind, 'roll');
});

test('온라인 함정 설치 시간초과 취소는 owner·piece·deadline이 일치해야 한다', () => {
  const placement = { ownerId: 'seat-1', pieceId: 'p1', nodeIds: ['n02'], nextTurnIndex: 1, deadline: 1000 };
  const state = {
    ...baseState(),
    pendingTrapPlacement: placement,
    turnDeadlineKind: 'trap_placement',
    turnDeadlineAt: placement.deadline,
    logs: [],
  } as EngineState & { pendingTrapPlacement: unknown; turnDeadlineKind: 'trap_placement'; turnDeadlineAt: number };

  const wrongPiece = withMockNow(1000 + TURN_NETWORK_GRACE_MS + 1, () => reduceAuthoritativeGameAction(
    state,
    { type: 'use_item', actorId: 'seat-1', payload: { cancelTrapPlacement: true, trapPlacementTimeoutRecovery: true, pieceId: 'p2', placementDeadline: placement.deadline, timeoutDeadlineAt: placement.deadline } },
    { playMode: 'individual', pieceCount: 4, stackedRollMode: true },
  ));
  const wrongDeadline = withMockNow(1000 + TURN_NETWORK_GRACE_MS + 1, () => reduceAuthoritativeGameAction(
    state,
    { type: 'use_item', actorId: 'seat-1', payload: { cancelTrapPlacement: true, trapPlacementTimeoutRecovery: true, pieceId: 'p1', placementDeadline: 999, timeoutDeadlineAt: placement.deadline } },
    { playMode: 'individual', pieceCount: 4, stackedRollMode: true },
  ));
  const wrongOwner = withMockNow(1000 + TURN_NETWORK_GRACE_MS + 1, () => reduceAuthoritativeGameAction(
    state,
    { type: 'use_item', actorId: 'seat-2', payload: { cancelTrapPlacement: true, trapPlacementTimeoutRecovery: true, pieceId: 'p1', placementDeadline: placement.deadline, timeoutDeadlineAt: placement.deadline } },
    { playMode: 'individual', pieceCount: 4, stackedRollMode: true },
  ));

  assert.equal(wrongPiece.status, 'rejected');
  assert.equal(wrongDeadline.status, 'rejected');
  assert.equal(wrongOwner.status, 'rejected');
});

test('온라인 함정 설치 시간초과 전 위조 취소는 거부한다', () => {
  const placement = { ownerId: 'seat-1', pieceId: 'p1', nodeIds: ['n02'], nextTurnIndex: 1, deadline: 1000 };
  const result = withMockNow(999, () => reduceAuthoritativeGameAction(
    {
      ...baseState(),
      pendingTrapPlacement: placement,
      turnDeadlineKind: 'trap_placement',
      turnDeadlineAt: placement.deadline,
      logs: [],
    } as EngineState & { pendingTrapPlacement: unknown; turnDeadlineKind: 'trap_placement'; turnDeadlineAt: number },
    { type: 'use_item', actorId: 'seat-1', payload: { cancelTrapPlacement: true, trapPlacementTimeoutRecovery: true, pieceId: 'p1', placementDeadline: placement.deadline, timeoutDeadlineAt: placement.deadline } },
    { playMode: 'individual', pieceCount: 4, stackedRollMode: true },
  ));

  assert.equal(result.status, 'rejected');
  assert.equal(result.reason, '시간초과 네트워크 유예 시간이 아직 남아 있습니다.');
});

test('온라인 after_move 대기가 끝난 stale 함정 use_item은 거부한다', () => {
  const result = reduceAuthoritativeGameAction(
    {
      ...baseState(),
      pieces: [
        { id: 'p1', ownerId: 'seat-1', nodeIndex: 2, nodeId: 'n03', started: true, finished: false },
        { id: 'p2', ownerId: 'seat-2', nodeIndex: 0, nodeId: 'n01', started: false, finished: false },
      ],
      ownedItems: { 'seat-1': ['trap'] },
      lastMovedSeatId: 'seat-1',
      lastMovedPieceIds: ['p1'],
      itemPromptTiming: null,
      pendingAfterMoveTurnIndex: undefined,
      logs: [],
    },
    { type: 'use_item', actorId: 'seat-1', payload: { itemType: 'trap', pieceId: 'p1' } },
    { playMode: 'individual', pieceCount: 4, stackedRollMode: true },
  );

  assert.equal(result.status, 'rejected');
  assert.equal(result.reason, '아이템 사용 여부를 먼저 선택할 수 없습니다.');
});

test('설치된 함정은 밟지 않는 이동에는 유지되고 밟은 이동에서만 제거된다', () => {
  const untouched = reduceAuthoritativeGameAction(
    {
      ...baseState(),
      pieces: [
        { id: 'p1', ownerId: 'seat-1', nodeIndex: 0, nodeId: 'n01', started: false, finished: false },
        { id: 'p2', ownerId: 'seat-2', nodeIndex: 0, nodeId: 'n01', started: false, finished: false },
      ],
      roll: null,
      rollStack: [{ name: '도', steps: 1 }],
      trapNodes: [{ nodeId: 'n04', ownerId: 'seat-2' }],
      logs: [],
    },
    { type: 'move_piece', actorId: 'seat-1', payload: { pieceId: 'p1', branchChoice: 'outer', rollStackIndex: 0 } },
    { playMode: 'individual', pieceCount: 4, stackedRollMode: true },
    [{ id: 'seat-1', team: '청팀' }, { id: 'seat-2', team: '홍팀' }],
  );

  assert.equal(untouched.status, 'committed');
  assert.deepEqual(untouched.patch?.trapNodes, [{ nodeId: 'n04', ownerId: 'seat-2' }]);

  const stepped = reduceAuthoritativeGameAction(
    {
      ...baseState(),
      pieces: untouched.patch?.pieces as EngineState['pieces'],
      roll: null,
      rollStack: [{ name: '개', steps: 2 }],
      trapNodes: untouched.patch?.trapNodes as EngineState['trapNodes'],
      logs: [],
    },
    { type: 'move_piece', actorId: 'seat-1', payload: { pieceId: 'p1', branchChoice: 'outer', rollStackIndex: 0 } },
    { playMode: 'individual', pieceCount: 4, stackedRollMode: true },
    [{ id: 'seat-1', team: '청팀' }, { id: 'seat-2', team: '홍팀' }],
  );

  assert.equal(stepped.status, 'committed');
  assert.deepEqual(stepped.patch?.trapNodes, []);
  const moved = (stepped.patch?.pieces as EngineState['pieces']).find((piece) => piece.id === 'p1');
  assert.equal(moved?.nodeId, 'n01');
  assert.equal(moved?.started, false);
});

test('온라인 일반 roll은 클라이언트 forcedResult를 거부한다', () => {
  const result = reduceAuthoritativeGameAction(
    baseState(),
    { type: 'roll_yut', actorId: 'seat-1', payload: { forcedResult: { name: '윷', steps: 4, bonus: true } } },
    { playMode: 'individual', pieceCount: 4, stackedRollMode: false },
  );

  assert.equal(result.status, 'rejected');
  assert.equal(result.reason, '허용되지 않은 윷 결과입니다.');
});


test('온라인 다시 던지기는 클라이언트 replacementRoll을 거부한다', () => {
  const result = reduceAuthoritativeGameAction(
    {
      ...baseState(),
      roll: { name: '도', steps: 1 },
      itemPromptTiming: 'after_roll',
      ownedItems: { 'seat-1': ['reroll'] },
      logs: [],
    } as EngineState & { itemPromptTiming: 'after_roll' },
    { type: 'use_item', actorId: 'seat-1', payload: { itemType: 'reroll', replacementRoll: { name: '모', steps: 5, bonus: true } } },
    { playMode: 'individual', pieceCount: 4, stackedRollMode: false },
  );

  assert.equal(result.status, 'rejected');
  assert.equal(result.reason, '허용되지 않은 다시 던지기 결과입니다.');
});


test('온라인 move는 클라이언트 extraSteps 조작을 거부한다', () => {
  const result = reduceAuthoritativeGameAction(
    { ...baseState(), roll: { name: '도', steps: 1 } },
    { type: 'move_piece', actorId: 'seat-1', payload: { pieceId: 'p1', branchChoice: 'outer', extraSteps: 99 } },
    { playMode: 'individual', pieceCount: 4, stackedRollMode: false },
  );

  assert.equal(result.status, 'rejected');
  assert.equal(result.reason, '허용되지 않은 추가 이동값입니다.');
});

test('온라인 after_move 대기 후 사용 안 함은 서버 pendingAfterMoveTurnIndex로 다음 턴 전환한다', () => {
  const result = reduceAuthoritativeGameAction(
    {
      ...baseState(),
      turnIndex: 0,
      itemPromptTiming: 'after_move',
      pendingAfterMoveTurnIndex: 1,
      lastMovedSeatId: 'seat-1',
      lastMovedPieceIds: ['p1'],
    } as EngineState & { itemPromptTiming: 'after_move'; pendingAfterMoveTurnIndex: number },
    { type: 'use_item', actorId: 'seat-1', payload: { skipAfterMoveItem: true } },
    { playMode: 'individual', pieceCount: 4, stackedRollMode: false },
  );

  assert.equal(result.status, 'committed');
  assert.equal(result.patch?.turnIndex, 1);
  assert.equal(result.patch?.pendingAfterMoveTurnIndex, null);
  assert.equal(result.patch?.turnDeadlineKind, 'roll');
});

test('온라인 황금 윷은 사용 후 서버 선택 대기를 기록하고 선택 결과를 그대로 확정한다', () => {
  const used = reduceAuthoritativeGameAction(
    {
      ...baseState(),
      ownedItems: { 'seat-1': ['golden_yut'] },
      itemPromptTiming: 'before_roll',
      logs: [],
    } as EngineState & { itemPromptTiming: 'before_roll' },
    { type: 'use_item', actorId: 'seat-1', payload: { itemType: 'golden_yut' } },
    { playMode: 'individual', pieceCount: 4, stackedRollMode: false },
  );

  assert.equal(used.status, 'committed');
  assert.deepEqual(used.patch?.pendingGoldenYutSelection, { actorId: 'seat-1', deadline: used.patch?.turnDeadlineAt });

  const selected = reduceAuthoritativeGameAction(
    {
      ...baseState(),
      ...used.patch,
      logs: used.patch?.logs ?? [],
    } as EngineState & { pendingGoldenYutSelection: unknown },
    { type: 'roll_yut', actorId: 'seat-1', payload: { rollTimingZone: 'normal', selectedGoldenYutResult: { name: '모', steps: 5, bonus: true } } },
    { playMode: 'individual', pieceCount: 4, stackedRollMode: false },
  );

  assert.equal(selected.status, 'committed');
  assert.deepEqual(selected.patch?.roll, { name: '모', steps: 5, bonus: true });
  assert.equal(selected.patch?.pendingGoldenYutSelection, null);
});

test('온라인 황금 윷 선택 대기는 다른 actor의 결과 선택을 거부한다', () => {
  const result = reduceAuthoritativeGameAction(
    {
      ...baseState(),
      pendingGoldenYutSelection: { actorId: 'seat-1', deadline: Date.now() + 10000 },
      logs: [],
    } as EngineState & { pendingGoldenYutSelection: unknown },
    { type: 'roll_yut', actorId: 'seat-2', payload: { rollTimingZone: 'normal', selectedGoldenYutResult: { name: '모', steps: 5, bonus: true } } },
    { playMode: 'individual', pieceCount: 4, stackedRollMode: false },
  );

  assert.equal(result.status, 'rejected');
});

test('온라인 황금 윷 결과는 허용 목록의 name/steps/bonus 조합만 허용한다', () => {
  const result = reduceAuthoritativeGameAction(
    {
      ...baseState(),
      pendingGoldenYutSelection: { actorId: 'seat-1', deadline: Date.now() + 10000 },
      logs: [],
    } as EngineState & { pendingGoldenYutSelection: unknown },
    { type: 'roll_yut', actorId: 'seat-1', payload: { rollTimingZone: 'normal', selectedGoldenYutResult: { name: '도', steps: 5 } } },
    { playMode: 'individual', pieceCount: 4, stackedRollMode: false },
  );

  assert.equal(result.status, 'rejected');
  assert.equal(result.reason, '허용되지 않은 황금 윷 결과입니다.');
});

test('온라인 황금 윷 선택 deadline 만료 시 서버 기본 결과로 자동 확정한다', () => {
  const result = reduceAuthoritativeGameAction(
    {
      ...baseState(),
      pendingGoldenYutSelection: { actorId: 'seat-1', deadline: Date.now() - 1 },
      logs: [],
    } as EngineState & { pendingGoldenYutSelection: unknown },
    { type: 'roll_yut', actorId: 'seat-1', payload: { rollTimingZone: 'normal', timedOut: true } },
    { playMode: 'individual', pieceCount: 4, stackedRollMode: false },
  );

  assert.equal(result.status, 'committed');
  assert.deepEqual(result.patch?.roll, { name: '도', steps: 1 });
  assert.equal(result.patch?.pendingGoldenYutSelection, null);
});

test('온라인 일반 roll은 황금 윷 선택 결과와 잘못된 입력 시간을 거부한다', () => {
  const forgedGolden = reduceAuthoritativeGameAction(
    baseState(),
    { type: 'roll_yut', actorId: 'seat-1', payload: { rollTimingZone: 'normal', selectedGoldenYutResult: { name: '모', steps: 5, bonus: true } } },
    { playMode: 'individual', pieceCount: 4, stackedRollMode: false },
  );
  const badTiming = reduceAuthoritativeGameAction(
    baseState(),
    { type: 'roll_yut', actorId: 'seat-1', payload: { rollTimingZone: 'invalid' } },
    { playMode: 'individual', pieceCount: 4, stackedRollMode: false },
  );

  assert.equal(forgedGolden.status, 'rejected');
  assert.equal(badTiming.status, 'rejected');
});

test('온라인 AI 누적 추가 던지기는 서버 상태 전환마다 한 action씩 진행된다', () => withMockRandom([0.8, 0.1], () => {
  const firstRoll = reduceAuthoritativeGameAction(
    { ...baseState(), logs: [] },
    { type: 'roll_yut', actorId: 'seat-1', payload: { rollTimingZone: 'perfect', stackedRollMode: true } },
    { playMode: 'individual', pieceCount: 4, stackedRollMode: true },
  );

  assert.equal(firstRoll.status, 'committed');
  assert.deepEqual(firstRoll.patch?.rollStack, [{ name: '윷', steps: 4, bonus: true }]);
  assert.equal(firstRoll.patch?.rollStackClosed, false);

  const secondRoll = reduceAuthoritativeGameAction(
    { ...baseState(), roll: null, rollStack: firstRoll.patch?.rollStack, rollStackClosed: firstRoll.patch?.rollStackClosed as boolean, logs: [] },
    { type: 'roll_yut', actorId: 'seat-1', payload: { rollTimingZone: 'perfect', stackedRollMode: true } },
    { playMode: 'individual', pieceCount: 4, stackedRollMode: true },
  );

  assert.equal(secondRoll.status, 'committed');
  assert.deepEqual(secondRoll.patch?.rollStack, [{ name: '윷', steps: 4, bonus: true }, { name: '도', steps: 1 }]);
  assert.equal(secondRoll.patch?.rollStackClosed, true);

  const move = reduceAuthoritativeGameAction(
    {
      ...baseState(),
      roll: null,
      rollStack: secondRoll.patch?.rollStack,
      rollStackClosed: secondRoll.patch?.rollStackClosed as boolean,
      selectedRollStackIndex: 1,
      logs: [],
    },
    { type: 'move_piece', actorId: 'seat-1', payload: { pieceId: 'p1', branchChoice: 'outer', rollStackIndex: 1 } },
    { playMode: 'individual', pieceCount: 4, stackedRollMode: true },
    [{ id: 'seat-1', team: '청팀' }, { id: 'seat-2', team: '홍팀' }],
  );

  assert.equal(move.status, 'committed');
  assert.deepEqual(move.patch?.rollStack, [{ name: '윷', steps: 4, bonus: true }]);
  assert.equal(move.patch?.turnIndex, 0);
}));

test('온라인 AI 일반 roll 후 after_roll 선택이 끝나야 이동 action이 허용된다', () => withMockRandom([0.1], () => {
  const rollAction = reduceAuthoritativeGameAction(
    { ...baseState(), ownedItems: { 'seat-1': ['move_plus_one'] }, logs: [] },
    { type: 'roll_yut', actorId: 'seat-1', payload: { rollTimingZone: 'perfect' } },
    { playMode: 'individual', pieceCount: 4, stackedRollMode: false },
  );

  assert.equal(rollAction.status, 'committed');
  assert.equal(rollAction.patch?.itemPromptTiming, 'after_roll');

  const blockedMove = reduceAuthoritativeGameAction(
    {
      ...baseState(),
      roll: rollAction.patch?.roll,
      ownedItems: { 'seat-1': ['move_plus_one'] },
      itemPromptTiming: 'after_roll',
      logs: [],
    } as EngineState & { itemPromptTiming: 'after_roll' },
    { type: 'move_piece', actorId: 'seat-1', payload: { pieceId: 'p1', branchChoice: 'outer' } },
    { playMode: 'individual', pieceCount: 4, stackedRollMode: false },
  );

  assert.equal(blockedMove.status, 'rejected');
  assert.equal(blockedMove.reason, '아이템 사용 여부를 먼저 선택해주세요.');

  const skipPrompt = reduceAuthoritativeGameAction(
    {
      ...baseState(),
      roll: rollAction.patch?.roll,
      ownedItems: { 'seat-1': ['move_plus_one'] },
      itemPromptTiming: 'after_roll',
      logs: [],
    } as EngineState & { itemPromptTiming: 'after_roll' },
    { type: 'use_item', actorId: 'seat-1', payload: { skipAfterRollItem: true } },
    { playMode: 'individual', pieceCount: 4, stackedRollMode: false },
  );

  assert.equal(skipPrompt.status, 'committed');
  assert.equal(skipPrompt.patch?.itemPromptTiming, null);
  assert.equal(skipPrompt.patch?.turnDeadlineKind, 'move');
}));

test('온라인 AI 함정은 use_item snapshot 뒤 place_trap action에서 다음 턴으로 진행된다', () => {
  const useTrap = reduceAuthoritativeGameAction(
    {
      ...baseState(),
      pieces: [
        { id: 'p1', ownerId: 'seat-1', nodeIndex: 2, nodeId: 'n03', started: true, finished: false },
        { id: 'p2', ownerId: 'seat-2', nodeIndex: 0, nodeId: 'n01', started: false, finished: false },
      ],
      ownedItems: { 'seat-1': ['trap'] },
      lastMovedSeatId: 'seat-1',
      lastMovedPieceIds: ['p1'],
      itemPromptTiming: 'after_move',
      pendingAfterMoveTurnIndex: 1,
      logs: [],
    } as EngineState & { itemPromptTiming: 'after_move'; pendingAfterMoveTurnIndex: number },
    { type: 'use_item', actorId: 'seat-1', payload: { itemType: 'trap', pieceId: 'p1' } },
    { playMode: 'individual', pieceCount: 4, stackedRollMode: false },
  );

  assert.equal(useTrap.status, 'committed');
  assert.equal(useTrap.patch?.turnIndex, undefined);
  const pendingPlacement = useTrap.patch?.pendingTrapPlacement as { nextTurnIndex: number } | undefined;
  assert.equal(pendingPlacement?.nextTurnIndex, 1);
  assert.equal(Boolean(pendingPlacement), true);

  const placeTrap = reduceAuthoritativeGameAction(
    {
      ...baseState(),
      pieces: [
        { id: 'p1', ownerId: 'seat-1', nodeIndex: 2, nodeId: 'n03', started: true, finished: false },
        { id: 'p2', ownerId: 'seat-2', nodeIndex: 0, nodeId: 'n01', started: false, finished: false },
      ],
      ownedItems: { 'seat-1': ['trap'] },
      pendingTrapPlacement: useTrap.patch?.pendingTrapPlacement,
      pendingAfterMoveTurnIndex: 1,
      logs: [],
    } as EngineState & { pendingAfterMoveTurnIndex: number },
    { type: 'place_trap', actorId: 'seat-1', payload: { pieceId: 'p1', nodeId: 'n04' } },
    { playMode: 'individual', pieceCount: 4, stackedRollMode: false },
  );

  assert.equal(placeTrap.status, 'committed');
  assert.equal(placeTrap.patch?.turnIndex, 1);
  assert.equal(placeTrap.patch?.pendingTrapPlacement, null);
  assert.deepEqual(placeTrap.patch?.trapNodes, [{ nodeId: 'n04', ownerId: 'seat-1' }]);
});

test('온라인 같은 시점 아이템 발견은 교체 대기를 저장하고 기존 아이템을 보존한다', () => {
  const state = baseState();
  state.roll = { name: '도', steps: 1 };
  state.pieces = state.pieces.map((piece) => piece.id === 'p1' ? { ...piece, started: true, nodeId: 'n02', nodeIndex: 1 } : piece);
  state.boardItems = [{ id: 'item-1', type: 'move_minus_one', nodeId: 'n03' }];
  state.ownedItems = { 'seat-1': ['move_plus_one'] };

  const result = reduceAuthoritativeGameAction(
    state,
    { type: 'move_piece', actorId: 'seat-1', payload: { pieceId: 'p1', branchChoice: 'outer' } },
    { playMode: 'individual', pieceCount: 4 },
  );

  assert.equal(result.status, 'committed');
  assert.deepEqual((result.patch?.ownedItems as Record<string, string[]>)['seat-1'], ['move_plus_one']);
  assert.deepEqual(result.patch?.boardItems, []);
  assert.equal((result.patch?.pendingItemPickup as { itemType?: string })?.itemType, 'move_minus_one');
});

test('온라인 아이템 교체 유지 선택은 기존 아이템을 보존하고 다음 턴을 재개한다', () => {
  const result = reduceAuthoritativeGameAction(
    {
      ...baseState(),
      turnIndex: 0,
      ownedItems: { 'seat-1': ['move_plus_one'] },
      pendingItemPickup: { ownerId: 'seat-1', itemId: 'item-1', itemType: 'move_minus_one', existingItemType: 'move_plus_one', nextTurnIndex: 1 },
    } as EngineState & { pendingItemPickup: unknown },
    { type: 'item_pickup_decision', actorId: 'seat-1', payload: { decision: 'keep' } },
    { playMode: 'individual', pieceCount: 4 },
  );

  assert.equal(result.status, 'committed');
  assert.deepEqual((result.patch?.ownedItems as Record<string, string[]>)['seat-1'], ['move_plus_one']);
  assert.equal(result.patch?.pendingItemPickup, null);
  assert.equal(result.patch?.turnIndex, 1);
});

test('온라인 아이템 교체 선택은 기존 아이템 한 개를 신규 아이템으로 바꾸고 after_move를 복원한다', () => {
  const result = reduceAuthoritativeGameAction(
    {
      ...baseState(),
      turnIndex: 0,
      ownedItems: { 'seat-1': ['move_plus_one', 'shield'] },
      pendingItemPickup: {
        ownerId: 'seat-1',
        itemId: 'item-1',
        itemType: 'move_minus_one',
        existingItemType: 'move_plus_one',
        nextTurnIndex: 1,
        resumeItemPromptTiming: 'after_move',
        resumePendingAfterMoveTurnIndex: 1,
      },
    } as EngineState & { pendingItemPickup: unknown },
    { type: 'item_pickup_decision', actorId: 'seat-1', payload: { decision: 'replace' } },
    { playMode: 'individual', pieceCount: 4 },
  );

  assert.equal(result.status, 'committed');
  assert.deepEqual((result.patch?.ownedItems as Record<string, string[]>)['seat-1'], ['move_minus_one', 'shield']);
  assert.equal(result.patch?.itemPromptTiming, 'after_move');
  assert.equal(result.patch?.pendingAfterMoveTurnIndex, 1);
  assert.equal(result.patch?.turnIndex, 0);
});


test('온라인 다시 던지기 item_used replay는 pending 확정 경로와 원격 1회 애니메이션 경로를 분리한다', () => {
  const appSource = readFileSync('src/app/App.tsx', 'utf8');
  const rerollReplayStart = appSource.indexOf('async function replayRerollItemSequence');
  assert.notEqual(rerollReplayStart, -1);
  const rerollReplaySource = appSource.slice(rerollReplayStart, appSource.indexOf('async function replayMissingSequencesThenApply'));
  assert.match(rerollReplaySource, /payload\.replacementRoll as YutResult/);
  assert.match(rerollReplaySource, /playResolvedRollAnimationAfterPending\(replacementRoll/);
  assert.match(rerollReplaySource, /playRollAnimationOnce\(replacementRoll/);
  assert.match(rerollReplaySource, /playSyncedRollSoundOnce\(replacementRoll/);
  assert.match(rerollReplaySource, /allowRollAnimation: false/);
  assert.ok(appSource.indexOf("sequence.type === 'item_used' && sequence.payload?.itemType === 'reroll'") < appSource.indexOf("sequence.type === 'roll_yut'"));
});
