import assert from 'node:assert/strict';
import test from 'node:test';
import { getMovePathNodeIds, getMovePathNodeIdsWithPrevious } from '../../src/game-core/board/board';
import { chooseAiRollTimingZone, getFallChanceForTimingZone, getRollTimingZone, rollYutResultWithTiming } from '../../src/game-core/roll';
import { canRoll, getRollActionBlockReasons, reduceMoveCommand, reduceRollCommand, type EngineLog, type EngineState } from '../../src/game-core/gameEngine';
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

test('누적 던지기 모드는 시간초과 던지기로 이동 대기 상태가 되면 같은 턴 수동 던지기를 거부한다', () => {
  const timeoutRoll = reduceAuthoritativeGameAction(
    { ...baseState(), logs: [] },
    {
      type: 'roll_yut',
      actorId: 'seat-1',
      payload: {
        forcedResult: { name: '도', steps: 1 },
        timedOut: true,
        timeoutRecoveredBy: 'roll_timeout',
      },
    },
    { playMode: 'individual', pieceCount: 4, stackedRollMode: true },
  );

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
    { type: 'roll_yut', actorId: 'seat-1', payload: { forcedResult: { name: '개', steps: 2 } } },
    { playMode: 'individual', pieceCount: 4, stackedRollMode: true },
  );

  assert.equal(manualRoll.status, 'rejected');
  assert.equal(manualRoll.reason, '이미 윷을 던졌습니다. 말을 이동해주세요.');
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



test('온라인 윷 던지기 성공 후 after_roll 아이템이 있으면 서버가 아이템 선택 대기를 연다', () => {
  const result = reduceAuthoritativeGameAction(
    {
      ...baseState(),
      ownedItems: { 'seat-1': ['move_plus_one'] },
    },
    { type: 'roll_yut', actorId: 'seat-1', payload: { forcedResult: { name: '도', steps: 1 } } },
    { playMode: 'individual', pieceCount: 4, stackedRollMode: false },
  );

  assert.equal(result.status, 'committed');
  assert.equal(result.patch?.itemPromptTiming, 'after_roll');
  assert.equal(result.patch?.turnDeadlineKind, 'item_prompt');
});

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
    { type: 'roll_yut', actorId: 'seat-1', payload: { forcedResult: { name: '도', steps: 1 } } },
    { playMode: 'individual', pieceCount: 4, stackedRollMode: true },
  );

  assert.equal(result.status, 'rejected');
  assert.equal(result.reason, '아이템 사용 여부를 먼저 선택해주세요.');
});

test('온라인 누적 다시 던지기는 선택된 이동 스택을 교체하고 append하지 않는다', () => {
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
    { type: 'use_item', actorId: 'seat-1', payload: { itemType: 'reroll', replacementRoll: { name: '걸', steps: 3 }, rollStackIndex: 0 } },
    { playMode: 'individual', pieceCount: 4, stackedRollMode: true },
  );

  assert.equal(result.status, 'committed');
  assert.deepEqual(result.patch?.rollStack, [{ name: '걸', steps: 3 }, { name: '개', steps: 2 }]);
  assert.deepEqual(result.patch?.roll, { name: '걸', steps: 3 });
  assert.equal(result.patch?.selectedRollStackIndex, 0);
  assert.deepEqual((result.patch?.ownedItems as Record<string, string[]>)['seat-1'], []);
});

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
      logs: [],
    },
    { type: 'use_item', actorId: 'seat-1', payload: { itemType: 'golden_yut' } },
    { playMode: 'individual', pieceCount: 4, stackedRollMode: true },
  );

  assert.equal(result.status, 'committed');
  assert.deepEqual((result.patch?.ownedItems as Record<string, string[]>)['seat-1'], []);
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
  const state = {
    ...baseState(),
    turnIndex: 0,
    pendingTrapPlacement: { ownerId: 'seat-1', pieceId: 'p1', nodeIds: ['n02'], nextTurnIndex: 1, deadline: 1 },
    itemPromptTiming: null,
    pendingAfterMoveTurnIndex: 1,
    logs: [],
  } as EngineState & { pendingTrapPlacement: unknown; pendingAfterMoveTurnIndex: number };

  const result = reduceAuthoritativeGameAction(
    state,
    { type: 'use_item', actorId: 'seat-1', payload: { cancelTrapPlacement: true } },
    { playMode: 'individual', pieceCount: 4, stackedRollMode: true },
  );

  assert.equal(result.status, 'committed');
  assert.equal(result.patch?.pendingTrapPlacement, null);
  assert.equal(result.patch?.itemPromptTiming, null);
  assert.equal(result.patch?.turnIndex, 1);
  assert.equal(result.patch?.pendingAfterMoveTurnIndex, null);
  assert.equal(result.patch?.turnDeadlineKind, 'roll');
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
