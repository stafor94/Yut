import assert from 'node:assert/strict';
import test from 'node:test';
import {
  LocalMoveLedger,
  classifyAuthoritativeDelivery,
  getAuthoritativeDeliveryIdentity,
} from '../../src/app/flows/localMoveOwnership';

const applied = {
  lastAppliedSequence: 20,
  lastAppliedStateVersion: 8,
};

const registerLocalMove = (ledger: LocalMoveLedger, clientMutationId: string) => ledger.register({
  roomId: 'room-a',
  clientMutationId,
  startSequence: 19,
  startTurnIndex: 0,
  pieceId: 'piece-1',
  movingGroupIds: ['piece-1'],
  fromNodeId: 'n01',
  toNodeId: 'n04',
  pathNodeIds: ['n02', 'n03', 'n04'],
  finalPieces: [],
  finalState: {},
  resultFingerprint: 'local-result',
});

test('활성 ledger의 action result만 local echo로 가로챈다', () => {
  const ledger = new LocalMoveLedger();
  const clientMutationId = 'move_piece:P1:20:piece-1';
  registerLocalMove(ledger, clientMutationId);
  const identity = getAuthoritativeDeliveryIdentity({
    status: 'committed',
    sequence: 20,
    stateAfter: {
      lastSequence: 20,
      turnVersion: 9,
      lastClientMutationId: clientMutationId,
    },
  });

  assert.equal(identity.deliveryKind, 'action-result');
  assert.equal(classifyAuthoritativeDelivery(identity, applied, ledger), 'local-echo');
});

test('활성 ledger의 subscription snapshot도 local echo로 가로챈다', () => {
  const ledger = new LocalMoveLedger();
  const clientMutationId = 'move_piece:P1:20:piece-1';
  registerLocalMove(ledger, clientMutationId);
  const identity = getAuthoritativeDeliveryIdentity({
    lastSequence: 20,
    turnVersion: 9,
    lastClientMutationId: clientMutationId,
    pieces: [],
  });

  assert.equal(identity.deliveryKind, 'state-snapshot');
  assert.equal(classifyAuthoritativeDelivery(identity, applied, ledger), 'local-echo');
});

test('이미 적용한 원격 action result도 기존 sequence 파이프라인에 위임한다', () => {
  const identity = getAuthoritativeDeliveryIdentity({
    status: 'committed',
    sequence: 20,
    stateAfter: {
      lastSequence: 20,
      turnVersion: 9,
      lastClientMutationId: 'roll_yut:P1:20',
    },
  });

  assert.equal(classifyAuthoritativeDelivery(identity, applied, new LocalMoveLedger()), 'remote-action');
});

test('새 원격 action result는 기존 sequence 파이프라인에 위임한다', () => {
  const identity = getAuthoritativeDeliveryIdentity({
    status: 'committed',
    sequence: 21,
    stateAfter: {
      lastSequence: 21,
      turnVersion: 9,
      lastClientMutationId: 'roll_yut:P2:21',
    },
  });

  assert.equal(classifyAuthoritativeDelivery(identity, applied, new LocalMoveLedger()), 'remote-action');
});

test('sequence와 stateVersion이 모두 이전인 snapshot도 subscription 정책에 위임한다', () => {
  const identity = getAuthoritativeDeliveryIdentity({
    lastSequence: 20,
    turnVersion: 8,
    lastClientMutationId: 'already-applied',
    pieces: [],
  });

  assert.equal(classifyAuthoritativeDelivery(identity, applied, new LocalMoveLedger()), 'remote-action');
});

test('clientMutationId가 없는 snapshot도 subscription 정책에 위임한다', () => {
  const identity = getAuthoritativeDeliveryIdentity({
    lastSequence: 20,
    turnVersion: 8,
    pieces: [],
  });

  assert.equal(classifyAuthoritativeDelivery(identity, applied, new LocalMoveLedger()), 'remote-action');
});
