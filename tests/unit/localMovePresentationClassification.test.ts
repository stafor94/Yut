import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyAuthoritativeDelivery,
  LocalMoveLedger,
} from '../../src/app/flows/localMoveOwnership';
import { LocalMovePresentationLifecycle } from '../../src/app/flows/localMovePresentationLifecycle';

const applied = { lastAppliedSequence: 4, lastAppliedStateVersion: 4 };

test('ledger가 없어도 실제 presenting 중인 같은 move 결과는 local echo로 분류한다', () => {
  const actionKey = 'move_piece:P1:4:0:걸:3:::piece-1:0:outer:stack:none';
  const lifecycle = new LocalMovePresentationLifecycle();
  const ledger = new LocalMoveLedger();

  lifecycle.begin(actionKey);
  assert.equal(
    classifyAuthoritativeDelivery({ clientMutationId: actionKey }, applied, ledger, lifecycle),
    'remote-action',
    '말 프레임을 아직 관찰하지 않은 pending 요청은 무조건 숨기지 않습니다.',
  );

  assert.equal(lifecycle.observe('piece-1', 'n01'), true);
  assert.equal(
    classifyAuthoritativeDelivery({ clientMutationId: actionKey }, applied, ledger, lifecycle),
    'local-echo',
  );
  assert.equal(
    classifyAuthoritativeDelivery({ clientMutationId: `${actionKey}:other` }, applied, ledger, lifecycle),
    'remote-action',
  );

  lifecycle.cancel();
  assert.equal(
    classifyAuthoritativeDelivery({ clientMutationId: actionKey }, applied, ledger, lifecycle),
    'remote-action',
  );
});

test('ledger가 유지된 move 결과는 presentation 상태와 무관하게 local echo다', () => {
  const actionKey = 'move_piece:P1:4:0:걸:3:::piece-1:0:outer:stack:none';
  const lifecycle = new LocalMovePresentationLifecycle();
  const ledger = new LocalMoveLedger();
  ledger.register({
    roomId: 'room-a',
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

  assert.equal(
    classifyAuthoritativeDelivery({ clientMutationId: actionKey }, applied, ledger, lifecycle),
    'local-echo',
  );
});
