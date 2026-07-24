import assert from 'node:assert/strict';
import test from 'node:test';
import {
  acceptMovePresentationFrame,
  createMovePresentationSession,
  getMovePresentationFinalization,
  type MovePresentationPiece,
  type MovePresentationSession,
} from '../../src/app/flows/movePresentation.js';

type TestPiece = MovePresentationPiece & { ownerId: string };
const sideKey = (piece: TestPiece) => piece.ownerId;
const piece = (id: string, ownerId: string, nodeId: string, started = true): TestPiece => ({
  id,
  ownerId,
  nodeId,
  started,
  finished: nodeId === 'finish',
});

const finalizeMove = (initial: TestPiece[], movingPieceId: string, frames: TestPiece[][], settled: TestPiece[]) => {
  const initialSession = createMovePresentationSession(initial, movingPieceId, sideKey);
  assert.ok(initialSession);
  let session: MovePresentationSession<TestPiece> = initialSession;
  for (const frame of frames) {
    const accepted = acceptMovePresentationFrame(session, frame);
    assert.equal(accepted.accepted, true);
    if (!accepted.accepted) throw new Error('move frame rejected');
    session = accepted.session;
  }
  return getMovePresentationFinalization(session, settled, sideKey);
};

test('move finalization infers delayed multi-piece capture', () => {
  const initial = [piece('red-1', 'red', 'n02'), piece('blue-1', 'blue', 'n03'), piece('blue-2', 'blue', 'n03')];
  const settled = [piece('red-1', 'red', 'n03'), piece('blue-1', 'blue', 'n01', false), piece('blue-2', 'blue', 'n01', false)];
  const result = finalizeMove(initial, 'red-1', [settled], settled);
  assert.deepEqual(result.capturedPieceIds, ['blue-1', 'blue-2']);
  assert.equal(result.shouldPlayStackSound, false);
});

test('stack sound plays only for a final join with a stationary same-side piece', () => {
  const initial = [piece('red-1', 'red', 'n02'), piece('red-2', 'red', 'n04')];
  const middle = [piece('red-1', 'red', 'n03'), piece('red-2', 'red', 'n04')];
  const settled = [piece('red-1', 'red', 'n04'), piece('red-2', 'red', 'n04')];
  assert.equal(finalizeMove(initial, 'red-1', [middle, settled], settled).shouldPlayStackSound, true);
});

test('moving an existing stack to an empty node does not create a new stack', () => {
  const initial = [piece('red-1', 'red', 'n02'), piece('red-2', 'red', 'n02')];
  const settled = [piece('red-1', 'red', 'n03'), piece('red-2', 'red', 'n03')];
  assert.equal(finalizeMove(initial, 'red-1', [settled], settled).shouldPlayStackSound, false);
});

test('passing over a same-side piece does not create a final stack', () => {
  const initial = [piece('red-1', 'red', 'n02'), piece('red-2', 'red', 'n03')];
  const middle = [piece('red-1', 'red', 'n03'), piece('red-2', 'red', 'n03')];
  const settled = [piece('red-1', 'red', 'n04'), piece('red-2', 'red', 'n03')];
  assert.equal(finalizeMove(initial, 'red-1', [middle, settled], settled).shouldPlayStackSound, false);
});
