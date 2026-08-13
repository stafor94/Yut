import assert from 'node:assert/strict';
import test from 'node:test';
import { applySequenceEvent } from '../../src/app/hooks/applySequenceEvent.js';

test('snapshot이 먼저 반영된 동일 sequence 잡기는 authoritative state를 재적용하지 않고 capture presentation만 보강한다', () => {
  const pieces = [
    { id: 'attacker', nodeId: 'n19', started: true },
    { id: 'target-1', nodeId: 'n01', started: false },
  ];
  const logs = [{ id: 9, text: 'snapshot log' }];
  const before = {
    pieces,
    logs,
    lastSequence: 2,
    turnVersion: 9,
    lastClientMutationId: 'snapshot-seen',
    turnIndex: 1,
    captureEffect: null,
  } as any;
  const lateEvent = {
    sequence: 2,
    type: 'move_piece_resolved',
    clientMutationId: 'move-capture-2',
    payload: { capturedPieceIds: ['target-1'] },
    patch: {
      turnIndex: 0,
      pieces: [{ id: 'should-not-apply', nodeId: 'n03' }],
    },
    logEntries: [{ id: 10, text: 'should not replay' }],
  };

  const result = applySequenceEvent(before, lateEvent);

  assert.notEqual(result, before);
  assert.equal(result?.lastSequence, 2);
  assert.equal(result?.turnVersion, 9);
  assert.equal(result?.lastClientMutationId, 'snapshot-seen');
  assert.equal(result?.turnIndex, 1);
  assert.equal(result?.pieces, pieces);
  assert.equal(result?.logs, logs);
  assert.deepEqual(result?.captureEffect, {
    id: 2,
    presentationKey: 'move-capture-2',
    pieceIds: ['target-1'],
  });
  assert.equal(applySequenceEvent(result, lateEvent), result);
});

test('현재 sequence보다 오래된 잡기 event는 presentation metadata도 다시 적용하지 않는다', () => {
  const before = {
    pieces: [{ id: 'attacker', nodeId: 'n20' }],
    logs: [],
    lastSequence: 3,
    turnVersion: 3,
    captureEffect: null,
  } as any;
  const oldEvent = {
    sequence: 2,
    type: 'move_piece_resolved',
    clientMutationId: 'old-capture-2',
    payload: { capturedPieceIds: ['target-1'] },
    patch: { turnIndex: 1 },
  };

  assert.equal(applySequenceEvent(before, oldEvent), before);
});
