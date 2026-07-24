import assert from 'node:assert/strict';
import test from 'node:test';
import {
  acceptMovePresentationFrame,
  createMovePresentationSession,
  getCapturePresentationSignature,
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

test('finish transition and capture signature are deterministic', () => {
  assert.equal(isSequentialMovePresentationNode('n01', 'finish'), true);
  assert.equal(isSequentialMovePresentationNode('n02', 'n05'), false);
  assert.equal(
    getCapturePresentationSignature({ nodeId: 'n06', pieceIds: ['blue-2', 'blue-1'] }),
    getCapturePresentationSignature({ nodeId: 'n06', pieceIds: ['blue-1', 'blue-2'] }),
  );
});
