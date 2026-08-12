import assert from 'node:assert/strict';
import test from 'node:test';
import { applySequenceEvent } from '../../src/app/hooks/applySequenceEvent.js';

const makeSequence = (overrides: Record<string, unknown> = {}) => ({
  id: '6',
  sequence: 6,
  type: 'move_piece_resolved',
  actorId: 'P1',
  schemaVersion: 2,
  clientMutationId: 'move-6',
  patch: { rollStack: [{ name: '빽도', steps: -1 }] },
  ...overrides,
});

test('normal contiguous replay increments turnVersion once when sequence patch omits it', () => {
  const result = applySequenceEvent({
    lastSequence: 5,
    turnVersion: 5,
    lastClientMutationId: 'move-5',
  }, makeSequence());

  assert.equal(result?.lastSequence, 6);
  assert.equal(result?.turnVersion, 6);
  assert.equal(result?.lastClientMutationId, 'move-6');
});

test('already-applied mutation replay does not synthesize a second turnVersion increment', () => {
  const result = applySequenceEvent({
    lastSequence: 5,
    turnVersion: 6,
    lastClientMutationId: 'move-6',
  }, makeSequence());

  assert.equal(result?.lastSequence, 6);
  assert.equal(result?.turnVersion, 6);
  assert.equal(result?.lastClientMutationId, 'move-6');
});

test('explicit authoritative turnVersion in patch remains authoritative', () => {
  const result = applySequenceEvent({
    lastSequence: 5,
    turnVersion: 6,
    lastClientMutationId: 'move-6',
  }, makeSequence({ patch: { turnVersion: 9 } }));

  assert.equal(result?.turnVersion, 9);
});
