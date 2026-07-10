import assert from 'node:assert/strict';
import test from 'node:test';
import { makeBugReportSequenceExport } from '../../src/app/diagnostics/gameDiagnostics';

test('버그 리포트 sequence 내보내기는 최근 30개와 허용 필드만 포함한다', () => {
  const firestoreTimestamp = { toDate: () => new Date('2026-01-02T03:04:05.000Z'), seconds: 123, nanoseconds: 456 };
  const sequences = Array.from({ length: 35 }, (_, index) => ({
    sequence: index + 1,
    type: 'move_piece_resolved',
    actorId: 'seat-1',
    action: { type: 'move_piece', logs: [{ text: 'drop' }], sparkleEffect: { id: 'effect' }, undefinedValue: undefined },
    payload: { pieceId: 'p1', animationKey: 'drop', nested: { value: 1, logs: ['drop'] } },
    patch: {
      turnIndex: index,
      logs: [{ text: '너무 긴 로그' }],
      moveEffect: { id: 'effect' },
      pieces: [{ id: 'p1', ownerId: 'seat-1', nodeId: 'n02', started: true, finished: false, previousNodeId: 'n01' }],
      gameSeats: [{ id: 'seat-1', name: 'P1', isAI: false, isSubstitutedByAI: false, color: 'red' }],
      boardItems: [{ id: 'item-1', type: 'trap', nodeId: 'n03', ownerId: 'seat-2' }],
      ignoredField: 'drop',
    },
    stateBefore: { logs: ['drop'] },
    stateAfter: { logs: ['drop'] },
    clientMutationId: `mutation-${index + 1}`,
    clientCreatedAt: 1000 + index,
    createdAt: firestoreTimestamp,
    logs: ['drop'],
  }));

  const result = makeBugReportSequenceExport({
    capturedAt: '2026-01-03T00:00:00.000Z',
    roomId: 'room-1',
    latestState: {
      turnIndex: 7,
      logs: [{ text: 'drop' }],
      fallEffect: { id: 'drop' },
      pieces: [{ id: 'p1', ownerId: 'seat-1', nodeId: 'n02', started: true, finished: false, previousNodeId: 'n01' }],
      gameSeats: [{ id: 'seat-1', name: 'P1', isAI: false, isSubstitutedByAI: false, team: 'A' }],
      boardItems: [{ id: 'item-1', type: 'trap', nodeId: 'n03', ownerId: 'seat-2' }],
      ignoredField: 'drop',
    },
    sequences,
  });

  assert.equal(result.sequences.length, 30);
  assert.equal(result.sequences[0].sequence, 6);
  assert.equal(result.sequences[29].sequence, 35);
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes('stateBefore'), false);
  assert.equal(serialized.includes('stateAfter'), false);
  assert.equal(serialized.includes('logs'), false);
  assert.equal(serialized.includes('Effect'), false);
  assert.equal(serialized.includes('animation'), false);
  assert.equal(serialized.includes('ignoredField'), false);
  assert.ok(result.latestState);
  assert.deepEqual(result.latestState.pieces, [{ id: 'p1', ownerId: 'seat-1', nodeId: 'n02', started: true, finished: false }]);
  assert.deepEqual(result.latestState.gameSeats, [{ id: 'seat-1', name: 'P1', isAI: false, isSubstitutedByAI: false }]);
  assert.deepEqual(result.latestState.boardItems, [{ id: 'item-1', type: 'trap', nodeId: 'n03' }]);
  assert.equal(result.sequences[0].createdAt, '2026-01-02T03:04:05.000Z');
});
