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

test('이미 적용한 action result sequence는 더 최신 stateVersion이어도 stale이다', () => {
  const identity = getAuthoritativeDeliveryIdentity({
    status: 'committed',
    sequence: 20,
    stateAfter: {
      lastSequence: 20,
      turnVersion: 9,
      lastClientMutationId: 'roll_yut:P1:20',
    },
  });

  assert.equal(identity.deliveryKind, 'action-result');
  assert.equal(
    classifyAuthoritativeDelivery(identity, applied, new LocalMoveLedger()),
    'stale',
  );
});

test('새 action result sequence는 remote action으로 적용한다', () => {
  const identity = getAuthoritativeDeliveryIdentity({
    status: 'committed',
    sequence: 21,
    stateAfter: {
      lastSequence: 21,
      turnVersion: 9,
      lastClientMutationId: 'roll_yut:P2:21',
    },
  });

  assert.equal(identity.deliveryKind, 'action-result');
  assert.equal(
    classifyAuthoritativeDelivery(identity, applied, new LocalMoveLedger()),
    'remote-action',
  );
});

test('같은 sequence의 더 최신 subscription snapshot은 적용한다', () => {
  const identity = getAuthoritativeDeliveryIdentity({
    lastSequence: 20,
    turnVersion: 9,
    lastClientMutationId: 'roll_yut:P1:20',
    pieces: [],
  });

  assert.equal(identity.deliveryKind, 'state-snapshot');
  assert.equal(
    classifyAuthoritativeDelivery(identity, applied, new LocalMoveLedger()),
    'remote-action',
  );
});

test('낮은 sequence라도 더 최신 subscription stateVersion은 적용한다', () => {
  const identity = getAuthoritativeDeliveryIdentity({
    lastSequence: 19,
    turnVersion: 9,
    lastClientMutationId: 'coordinator-state-update',
    pieces: [],
  });

  assert.equal(identity.deliveryKind, 'state-snapshot');
  assert.equal(
    classifyAuthoritativeDelivery(identity, applied, new LocalMoveLedger()),
    'remote-action',
  );
});

test('sequence와 stateVersion이 모두 적용값 이하인 snapshot은 stale이다', () => {
  const identity = getAuthoritativeDeliveryIdentity({
    lastSequence: 20,
    turnVersion: 8,
    lastClientMutationId: 'already-applied',
    pieces: [],
  });

  assert.equal(
    classifyAuthoritativeDelivery(identity, applied, new LocalMoveLedger()),
    'stale',
  );
});