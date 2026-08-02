import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyAuthoritativeDelivery,
  LocalMoveLedger,
} from '../../src/app/flows/localMoveOwnership';
import { LocalMovePresentationLifecycle } from '../../src/app/flows/localMovePresentationLifecycle';

const actionKey = 'move_piece:P1:4:0:걸:3:::piece-1:0:outer:stack:none';
const roomId = 'room-a';
const applied = { lastAppliedSequence: 4, lastAppliedStateVersion: 4 };

const registerMove = (ledger: LocalMoveLedger) => ledger.register({
  roomId,
  clientMutationId: actionKey,
  startSequence: 4,
  startTurnIndex: 0,
  pieceId: 'piece-1',
  movingGroupIds: ['piece-1'],
  fromNodeId: 'n01',
  toNodeId: 'n04',
  pathNodeIds: ['n02', 'n03', 'n04'],
  finalPieces: [],
  finalState: {},
  resultFingerprint: 'fingerprint',
});

test('settled local move는 active ledger 정리 뒤 같은 mutation의 확정 sequence/version만 local echo로 유지한다', () => {
  const ledger = new LocalMoveLedger();
  const lifecycle = new LocalMovePresentationLifecycle();
  registerMove(ledger);

  assert.equal(ledger.markPresentationCompleted(actionKey), false);
  const observed = ledger.observeAuthoritativeResult({
    clientMutationId: actionKey,
    sequence: 5,
    stateVersion: 5,
    resultFingerprint: 'fingerprint',
  });

  assert.equal(observed.status, 'matched');
  assert.equal(ledger.has(actionKey), false);
  assert.equal(ledger.size(), 0);
  assert.equal(ledger.owns(actionKey), true);
  assert.equal(
    classifyAuthoritativeDelivery({ clientMutationId: actionKey, sequence: 5, stateVersion: 5 }, applied, ledger, lifecycle),
    'local-echo',
  );
  assert.equal(
    classifyAuthoritativeDelivery({ clientMutationId: actionKey, sequence: 5, stateVersion: 6 }, applied, ledger, lifecycle),
    'remote-action',
    '같은 mutation ID라도 더 최신 state version은 정상 적용해야 합니다.',
  );
  assert.equal(
    classifyAuthoritativeDelivery({ clientMutationId: actionKey, sequence: 6, stateVersion: 6 }, applied, ledger, lifecycle),
    'remote-action',
    '같은 mutation ID라도 더 최신 sequence는 정상 적용해야 합니다.',
  );
});

test('settled ownership은 room clear와 explicit remove에서 해제된다', () => {
  const ledger = new LocalMoveLedger();
  const lifecycle = new LocalMovePresentationLifecycle();
  registerMove(ledger);
  ledger.markPresentationCompleted(actionKey);
  ledger.observeAuthoritativeResult({
    clientMutationId: actionKey,
    sequence: 5,
    stateVersion: 5,
    resultFingerprint: 'fingerprint',
  });

  ledger.clearRoom(roomId);
  assert.equal(ledger.owns(actionKey), false);
  assert.equal(
    classifyAuthoritativeDelivery({ clientMutationId: actionKey, sequence: 5, stateVersion: 5 }, applied, ledger, lifecycle),
    'remote-action',
  );

  registerMove(ledger);
  ledger.markPresentationCompleted(actionKey);
  ledger.observeAuthoritativeResult({
    clientMutationId: actionKey,
    sequence: 5,
    stateVersion: 5,
    resultFingerprint: 'fingerprint',
  });
  assert.equal(ledger.remove(actionKey), true);
  assert.equal(ledger.owns(actionKey), false);
});
