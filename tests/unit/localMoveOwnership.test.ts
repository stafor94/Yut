import assert from 'node:assert/strict';
import test from 'node:test';
import {
  LocalMoveLedger,
  classifyAuthoritativeDelivery,
  makeLocalMoveResultFingerprint,
  prepareLocalMoveOwnership,
} from '../../src/app/flows/localMoveOwnership';
import { TURN_ACTION_TIMEOUT_MS } from '../../src/features/room/services/roomTiming';

const makeState = (overrides: Record<string, unknown> = {}) => ({
  pieces: [{ id: 'piece-1', ownerId: 'P1', nodeId: 'n04', nodeIndex: 3, started: true, finished: false }],
  turnIndex: 1,
  roll: null,
  rollStack: [],
  selectedRollStackIndex: null,
  rollStackClosed: false,
  boardItems: [],
  ownedItems: {},
  trapNodes: [],
  shieldedPieceIds: [],
  lastMovedPieceIds: ['piece-1'],
  lastMovedSeatId: 'P1',
  branchChoice: 'outer',
  pendingItemPickup: null,
  itemPromptTiming: null,
  pendingAfterMoveTurnIndex: null,
  turnDeadlineKind: 'roll',
  completedSeatIds: [],
  rankingSeatIds: [],
  gameEndMode: '',
  lastFinishedSeatId: '',
  winner: '',
  lastSequence: 10,
  turnVersion: 3,
  ...overrides,
});

const registerMove = (ledger: LocalMoveLedger, fingerprint = makeLocalMoveResultFingerprint(makeState())) => {
  const finalState = makeState();
  return ledger.register({
    roomId: 'room-a',
    clientMutationId: 'move:P1:10:piece-1',
    startSequence: 10,
    startTurnIndex: 0,
    pieceId: 'piece-1',
    movingGroupIds: ['piece-1'],
    fromNodeId: 'n01',
    toNodeId: 'n04',
    pathNodeIds: ['n02', 'n03', 'n04'],
    finalPieces: finalState.pieces,
    finalState,
    resultFingerprint: fingerprint,
  });
};

const makeOnlineMoveState = () => ({
  playMode: 'individual' as const,
  pieceCount: 1 as const,
  stackedRollMode: false,
  gameSeats: [
    { id: 'P1', team: '청팀' as const },
    { id: 'P2', team: '홍팀' as const },
  ],
  turnOrderIds: ['P1', 'P2'],
  turnIndex: 0,
  pieces: [
    { id: 'piece-1', ownerId: 'P1', nodeId: 'n01', nodeIndex: 0, started: false, finished: false, previousNodeId: '' },
    { id: 'piece-2', ownerId: 'P2', nodeId: 'n01', nodeIndex: 0, started: false, finished: false, previousNodeId: '' },
  ],
  roll: { name: '걸', steps: 3, bonus: false },
  rollStack: [],
  selectedRollStackIndex: null,
  rollStackClosed: false,
  branchChoice: 'outer',
  boardItems: [],
  ownedItems: {},
  trapNodes: [],
  shieldedPieceIds: [],
  logs: [],
  lastMovedPieceIds: [],
  lastMovedSeatId: '',
  pendingItemPickup: null,
  itemPromptTiming: null,
  pendingAfterMoveTurnIndex: null,
  pendingGoldenYutSelection: null,
  pendingTrapPlacement: null,
  completedSeatIds: [],
  rankingSeatIds: [],
  gameEndMode: '',
  lastFinishedSeatId: '',
  winner: '',
  autoPlayBySeatId: {},
  turnActionTimeoutCountBySeatId: {},
  turnDeadlineKind: 'move',
  turnDeadlineAt: Date.now() + TURN_ACTION_TIMEOUT_MS,
  lastSequence: 10,
  turnVersion: 3,
});

test('온라인 로컬 이동은 서버 응답 전에 공유 reducer로 최종 상태와 path를 확정한다', () => {
  const clientMutationId = 'move_piece:P1:10:0:piece-1';
  const prepared = prepareLocalMoveOwnership({
    roomId: 'room-a',
    state: makeOnlineMoveState(),
    action: {
      type: 'move_piece',
      actorId: 'P1',
      payload: {
        pieceId: 'piece-1',
        extraSteps: 0,
        branchChoice: 'outer',
        rollStackIndex: null,
        clientActionId: clientMutationId,
        clientActionStartedAt: Date.now(),
      },
    },
  });

  assert.ok(prepared);
  const movedPiece = prepared.finalState.pieces?.find((piece) => (piece as { id?: string }).id === 'piece-1') as { nodeId?: string } | undefined;
  assert.equal(prepared.record.clientMutationId, clientMutationId);
  assert.deepEqual(prepared.record.pathNodeIds, ['n02', 'n03', 'n04']);
  assert.equal(prepared.record.fromNodeId, 'n01');
  assert.equal(prepared.record.toNodeId, 'n04');
  assert.equal(movedPiece?.nodeId, 'n04');
  assert.equal(prepared.finalState.roll, null);
  assert.equal(prepared.finalState.turnIndex, 1);
  assert.deepEqual(prepared.finalState.lastMovedPieceIds, ['piece-1']);
});

test('coordinator 복구 이동은 로컬 presentation 소유권을 선점하지 않는다', () => {
  const prepared = prepareLocalMoveOwnership({
    roomId: 'room-a',
    state: makeOnlineMoveState(),
    action: {
      type: 'move_piece',
      actorId: 'P1',
      payload: {
        pieceId: 'piece-1',
        extraSteps: 0,
        branchChoice: 'outer',
        clientActionId: 'move_piece_timeout:P1:10',
        recoveredByCoordinator: true,
      },
    },
  });
  assert.equal(prepared, null);
});

test('local ledger는 pending ACK와 별개로 presentation과 server sequence 확인 전까지 유지된다', () => {
  const ledger = new LocalMoveLedger();
  const record = registerMove(ledger);

  assert.equal(record.localPresentationCompleted, false);
  assert.equal(ledger.size(), 1);
  const observed = ledger.observeAuthoritativeResult({
    clientMutationId: record.clientMutationId,
    sequence: 11,
    stateVersion: 4,
    resultFingerprint: record.resultFingerprint,
  });
  assert.equal(observed.status, 'matched');
  assert.equal(ledger.size(), 1);

  assert.equal(ledger.markPresentationCompleted(record.clientMutationId), true);
  assert.equal(ledger.size(), 0);
});

test('빠른 ACK가 presentation보다 먼저 와도 로컬 최종 상태의 sequence/version을 보존한다', () => {
  const ledger = new LocalMoveLedger();
  const record = registerMove(ledger);
  ledger.observeAuthoritativeResult({
    clientMutationId: record.clientMutationId,
    sequence: 15,
    stateVersion: 8,
    resultFingerprint: record.resultFingerprint,
  });

  assert.equal(record.finalState.lastSequence, 15);
  assert.equal(record.finalState.turnVersion, 8);
  assert.equal(record.finalState.lastClientMutationId, record.clientMutationId);
});

test('pending 메타데이터가 없어도 ledger clientMutationId는 local echo로 분류된다', () => {
  const ledger = new LocalMoveLedger();
  const record = registerMove(ledger);

  assert.equal(classifyAuthoritativeDelivery({
    clientMutationId: record.clientMutationId,
    sequence: 11,
    stateVersion: 4,
  }, {
    lastAppliedSequence: 10,
    lastAppliedStateVersion: 3,
  }, ledger), 'local-echo');
});

test('ledger 정리 후 동일 sequence는 stale로 분류되어 다시 재생되지 않는다', () => {
  const ledger = new LocalMoveLedger();
  const record = registerMove(ledger);
  ledger.observeAuthoritativeResult({
    clientMutationId: record.clientMutationId,
    sequence: 11,
    stateVersion: 4,
    resultFingerprint: record.resultFingerprint,
  });
  ledger.markPresentationCompleted(record.clientMutationId);

  assert.equal(classifyAuthoritativeDelivery({
    clientMutationId: record.clientMutationId,
    sequence: 11,
    stateVersion: 4,
  }, {
    lastAppliedSequence: 11,
    lastAppliedStateVersion: 4,
  }, ledger), 'stale');
});

test('다른 플레이어의 새 sequence는 remote action으로 분류된다', () => {
  const ledger = new LocalMoveLedger();
  registerMove(ledger);

  assert.equal(classifyAuthoritativeDelivery({
    clientMutationId: 'move:P2:11:piece-2',
    sequence: 12,
    stateVersion: 5,
  }, {
    lastAppliedSequence: 11,
    lastAppliedStateVersion: 4,
  }, ledger), 'remote-action');
});

test('이미 적용한 snapshot은 stale로 분류된다', () => {
  assert.equal(classifyAuthoritativeDelivery({
    clientMutationId: 'remote-action',
    sequence: 20,
    stateVersion: 8,
  }, {
    lastAppliedSequence: 20,
    lastAppliedStateVersion: 8,
  }, new LocalMoveLedger()), 'stale');
});

test('같은 sequence라도 더 최신 stateVersion snapshot은 적용한다', () => {
  assert.equal(classifyAuthoritativeDelivery({
    clientMutationId: 'remote-state-update',
    sequence: 20,
    stateVersion: 9,
  }, {
    lastAppliedSequence: 20,
    lastAppliedStateVersion: 8,
  }, new LocalMoveLedger()), 'remote-action');
});

test('낮은 sequence라도 더 최신 stateVersion snapshot은 적용한다', () => {
  assert.equal(classifyAuthoritativeDelivery({
    clientMutationId: 'remote-recovery-state',
    sequence: 19,
    stateVersion: 9,
  }, {
    lastAppliedSequence: 20,
    lastAppliedStateVersion: 8,
  }, new LocalMoveLedger()), 'remote-action');
});

test('fingerprint 불일치는 hard resync를 한 번만 소유한다', () => {
  const ledger = new LocalMoveLedger();
  const record = registerMove(ledger);
  const observed = ledger.observeAuthoritativeResult({
    clientMutationId: record.clientMutationId,
    sequence: 11,
    stateVersion: 4,
    resultFingerprint: makeLocalMoveResultFingerprint(makeState({ turnIndex: 0 })),
  });

  assert.equal(observed.status, 'mismatch');
  assert.equal(ledger.claimHardResync(record.clientMutationId), true);
  assert.equal(ledger.claimHardResync(record.clientMutationId), false);
  assert.equal(ledger.size(), 1);
});

test('방 변경 시 해당 방의 local move ledger를 전부 정리한다', () => {
  const ledger = new LocalMoveLedger();
  registerMove(ledger);
  const finalState = makeState({ pieces: [] });
  ledger.register({
    roomId: 'room-b',
    clientMutationId: 'move:P2:3:piece-2',
    startSequence: 3,
    startTurnIndex: 1,
    pieceId: 'piece-2',
    movingGroupIds: ['piece-2'],
    fromNodeId: 'n02',
    toNodeId: 'n03',
    pathNodeIds: ['n03'],
    finalPieces: [],
    finalState,
    resultFingerprint: makeLocalMoveResultFingerprint(finalState),
  });

  ledger.clearRoom('room-a');
  assert.equal(ledger.has('move:P1:10:piece-1'), false);
  assert.equal(ledger.has('move:P2:3:piece-2'), true);
});

test('시간 기반 deadline 차이는 이동 결과 fingerprint를 바꾸지 않는다', () => {
  assert.equal(
    makeLocalMoveResultFingerprint(makeState({ turnDeadlineAt: 1000, pendingItemPickup: { ownerId: 'P1', itemId: 'item-1', itemType: 'shield', existingItemType: 'trap', deadline: 1000 } })),
    makeLocalMoveResultFingerprint(makeState({ turnDeadlineAt: 9000, pendingItemPickup: { ownerId: 'P1', itemId: 'item-1', itemType: 'shield', existingItemType: 'trap', deadline: 9000 } })),
  );
});