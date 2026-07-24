import assert from 'node:assert/strict';
import test from 'node:test';
import {
  acceptMovePresentationFrame,
  createMovePresentationSession,
  getCapturePresentationSignature,
  getMovePresentationFinalization,
  isSequentialMovePresentationNode,
  type MovePresentationPiece,
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

test('authoritative final frame cannot overtake unfinished local move frames', () => {
  const initial = [piece('red-1', 'red', 'n01', false), piece('blue-1', 'blue', 'n04')];
  const session = createMovePresentationSession(initial, 'red-1', sideKey);
  assert.ok(session);

  const firstLocal = acceptMovePresentationFrame(session, [piece('red-1', 'red', 'n02'), piece('blue-1', 'blue', 'n04')]);
  assert.equal(firstLocal.accepted, true);
  if (!firstLocal.accepted) return;

  const authoritativeFinal = acceptMovePresentationFrame(firstLocal.session, [piece('red-1', 'red', 'n04'), piece('blue-1', 'blue', 'n01', false)]);
  assert.equal(authoritativeFinal.accepted, false);
  assert.equal(firstLocal.session.acceptedPieces.find((item) => item.id === 'blue-1')?.nodeId, 'n04');
});

test('accepted local frames update only the moving group and keep capture targets on the board', () => {
  const initial = [piece('red-1', 'red', 'n01', false), piece('blue-1', 'blue', 'n03')];
  const session = createMovePresentationSession(initial, 'red-1', sideKey);
  assert.ok(session);

  const firstLocal = acceptMovePresentationFrame(session, [piece('red-1', 'red', 'n02'), piece('blue-1', 'blue', 'n01', false)]);
  assert.equal(firstLocal.accepted, true);
  if (!firstLocal.accepted) return;
  assert.equal(firstLocal.pieces.find((item) => item.id === 'red-1')?.nodeId, 'n02');
  assert.equal(firstLocal.pieces.find((item) => item.id === 'blue-1')?.nodeId, 'n03');

  const landing = acceptMovePresentationFrame(firstLocal.session, [piece('red-1', 'red', 'n03'), piece('blue-1', 'blue', 'n01', false)]);
  assert.equal(landing.accepted, true);
  if (!landing.accepted) return;
  assert.equal(landing.pieces.find((item) => item.id === 'red-1')?.nodeId, 'n03');
  assert.equal(landing.pieces.find((item) => item.id === 'blue-1')?.nodeId, 'n03');
});

test('one-step authoritative landing is allowed but non-moving pieces stay frozen until settlement', () => {
  const initial = [piece('red-1', 'red', 'n02'), piece('blue-1', 'blue', 'n03')];
  const session = createMovePresentationSession(initial, 'red-1', sideKey);
  assert.ok(session);

  const landing = acceptMovePresentationFrame(session, [piece('red-1', 'red', 'n03'), piece('blue-1', 'blue', 'n01', false)]);
  assert.equal(landing.accepted, true);
  if (!landing.accepted) return;
  assert.equal(landing.pieces.find((item) => item.id === 'red-1')?.nodeId, 'n03');
  assert.equal(landing.pieces.find((item) => item.id === 'blue-1')?.nodeId, 'n03');
});

test('move finalization infers capture before a delayed capture effect arrives', () => {
  const initial = [piece('red-1', 'red', 'n02'), piece('blue-1', 'blue', 'n03'), piece('blue-2', 'blue', 'n03')];
  const session = createMovePresentationSession(initial, 'red-1', sideKey);
  assert.ok(session);

  const landing = acceptMovePresentationFrame(session, [piece('red-1', 'red', 'n03'), piece('blue-1', 'blue', 'n01', false), piece('blue-2', 'blue', 'n01', false)]);
  assert.equal(landing.accepted, true);
  if (!landing.accepted) return;

  const finalization = getMovePresentationFinalization(
    landing.session,
    [piece('red-1', 'red', 'n03'), piece('blue-1', 'blue', 'n01', false), piece('blue-2', 'blue', 'n01', false)],
    sideKey,
  );
  assert.deepEqual(finalization.capturedPieceIds, ['blue-1', 'blue-2']);
  assert.equal(finalization.shouldPlayStackSound, false);
});

test('stack sound is emitted only when the moving group finally joins a stationary same-side piece', () => {
  const initial = [piece('red-1', 'red', 'n02'), piece('red-2', 'red', 'n04'), piece('blue-1', 'blue', 'n06')];
  const session = createMovePresentationSession(initial, 'red-1', sideKey);
  assert.ok(session);

  const middle = acceptMovePresentationFrame(session, [piece('red-1', 'red', 'n03'), piece('red-2', 'red', 'n04'), piece('blue-1', 'blue', 'n06')]);
  assert.equal(middle.accepted, true);
  if (!middle.accepted) return;
  const landing = acceptMovePresentationFrame(middle.session, [piece('red-1', 'red', 'n04'), piece('red-2', 'red', 'n04'), piece('blue-1', 'blue', 'n06')]);
  assert.equal(landing.accepted, true);
  if (!landing.accepted) return;

  const finalization = getMovePresentationFinalization(
    landing.session,
    [piece('red-1', 'red', 'n04'), piece('red-2', 'red', 'n04'), piece('blue-1', 'blue', 'n06')],
    sideKey,
  );
  assert.equal(finalization.shouldPlayStackSound, true);
});

test('moving an existing stack to an empty node does not count as a new stack', () => {
  const initial = [piece('red-1', 'red', 'n02'), piece('red-2', 'red', 'n02'), piece('blue-1', 'blue', 'n06')];
  const session = createMovePresentationSession(initial, 'red-1', sideKey);
  assert.ok(session);

  const landing = acceptMovePresentationFrame(session, [piece('red-1', 'red', 'n03'), piece('red-2', 'red', 'n03'), piece('blue-1', 'blue', 'n06')]);
  assert.equal(landing.accepted, true);
  if (!landing.accepted) return;

  const finalization = getMovePresentationFinalization(
    landing.session,
    [piece('red-1', 'red', 'n03'), piece('red-2', 'red', 'n03'), piece('blue-1', 'blue', 'n06')],
    sideKey,
  );
  assert.equal(finalization.shouldPlayStackSound, false);
});

test('passing over a same-side piece does not count as a final stack', () => {
  const initial = [piece('red-1', 'red', 'n02'), piece('red-2', 'red', 'n03'), piece('blue-1', 'blue', 'n06')];
  const session = createMovePresentationSession(initial, 'red-1', sideKey);
  assert.ok(session);

  const middle = acceptMovePresentationFrame(session, [piece('red-1', 'red', 'n03'), piece('red-2', 'red', 'n03'), piece('blue-1', 'n06')]);
  assert.equal(middle.accepted, true);
  if (!middle.accepted) return;
  const landing = acceptMovePresentationFrame(middle.session, [piece('red-1', 'red', 'n04'), piece('red-2', 'red', 'n03'), piece('blue-1', 'blue', 'n06')]);
  assert.equal(landing.accepted, true);
  if (!landing.accepted) return;

  const finalization = getMovePresentationFinalization(
    landing.session,
    [piece('red-1', 'red', 'n04'), piece('red-2', 'red', 'n03'), piece('blue-1', 'blue', 'n06')],
    sideKey,
  );
  assert.equal(finalization.shouldPlayStackSound, false);
});

test('finish transition and capture signature are deterministic', () => {
  assert.equal(isSequentialMovePresentationNode('n01', 'finish'), true);
  assert.equal(isSequentialMovePresentationNode('n02', 'n05'), false);
  assert.equal(
    getCapturePresentationSignature({ nodeId: 'n06', pieceIds: ['blue-2', 'blue-1'] }),
    getCapturePresentationSignature({ nodeId: 'n06', pieceIds: ['blue-1', 'blue-2'] }),
  );
});
