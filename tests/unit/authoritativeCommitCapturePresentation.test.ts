import assert from 'node:assert/strict';
import test from 'node:test';
import {
  settleAuthoritativeCommit,
  withAuthoritativeCapturePresentation,
} from '../../src/features/room/services/authoritativeCommitTimeout.js';

const captureResult = () => ({
  status: 'committed',
  sequence: 12,
  turnVersion: 7,
  sequenceEvent: {
    sequence: 12,
    type: 'move_piece_resolved',
    clientMutationId: 'capture-move-12',
    payload: { capturedPieceIds: ['target-1'] },
  },
  stateAfter: {
    turnIndex: 3,
    pieces: [{ id: 'attacker', nodeId: 'n19' }, { id: 'target-1', nodeId: 'n01', started: false }],
  },
});

test('local authoritative capture commit keeps one-shot presentation metadata in the returned state only', async () => {
  const persistedResult = captureResult();
  const result = await settleAuthoritativeCommit({
    actionType: 'move_piece',
    commit: async () => persistedResult,
  });

  assert.deepEqual((result.stateAfter as Record<string, unknown> | undefined)?.captureEffect, {
    id: 12,
    presentationKey: 'capture-move-12',
    pieceIds: ['target-1'],
  });
  assert.equal((persistedResult.stateAfter as Record<string, unknown>).captureEffect, undefined);
});

test('non-capture results are returned unchanged', () => {
  const result = {
    ...captureResult(),
    sequenceEvent: {
      sequence: 12,
      type: 'move_piece_resolved',
      clientMutationId: 'move-12',
      payload: { capturedPieceIds: [] },
    },
  };
  assert.equal(withAuthoritativeCapturePresentation(result), result);
});
