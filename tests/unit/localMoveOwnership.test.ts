import assert from 'node:assert/strict';
import test from 'node:test';
import {
  LocalMoveLedger,
  classifyAuthoritativeDelivery,
  makeLocalMoveResultFingerprint,
} from '../../src/app/flows/localMoveOwnership';

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
  ...overrides,
});

const registerMove = (ledger: LocalMoveLedger, fingerprint = makeLocalMoveResultFingerprint(makeState())) => ledger.register({
  roomId: 'room-a',
  clientMutationId: 'move:P1:10:piece-1',
  startSequence: 10,
  startTurnIndex: 0,
  pieceId: 'piece-1',
  movingGroupIds: ['piece-1'],
  fromNodeId: 'n01',
  toNodeId: 'n04',
  pathNodeIds: ['n02', 'n03', 'n04'],
  finalPieces: makeState().pieces,
  resultFingerprint: fingerprint,
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
    resultFingerprint: makeLocalMoveResultFingerprint(makeState()),
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
