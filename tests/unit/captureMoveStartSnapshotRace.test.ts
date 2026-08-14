import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const appSource = fs.readFileSync(new URL('../../src/app/App.tsx', import.meta.url), 'utf8');

type RacePiece = {
  id: string;
  ownerId: string;
  nodeId: string;
  started: boolean;
  finished: boolean;
};

function capturablePieces(pieces: RacePiece[], destinationNodeId: string, attackerOwnerId: string) {
  return pieces.filter((piece) =>
    piece.ownerId !== attackerOwnerId
    && !piece.finished
    && piece.started
    && piece.nodeId === destinationNodeId
  );
}

test('capture presentation uses the move-start snapshot when authoritative echo settles during movement', () => {
  const movePieceSource = appSource.slice(
    appSource.indexOf('async function movePiece('),
    appSource.indexOf('function moveSelectedPiece('),
  );

  assert.match(
    movePieceSource,
    /const currentPieces = preparedPresentation\?\.currentPieces \?\? piecesRef\.current;/,
  );
  assert.match(
    movePieceSource,
    /const capturablePieces = currentPieces\.filter\(/,
  );
  assert.doesNotMatch(
    movePieceSource,
    /const capturablePieces = piecesRef\.current\.filter\(/,
  );

  const destinationNodeId = 'n05';
  const moveStartSnapshot: RacePiece[] = [
    { id: 'attacker-1', ownerId: 'blue', nodeId: 'n04', started: true, finished: false },
    { id: 'target-1', ownerId: 'red', nodeId: destinationNodeId, started: true, finished: false },
  ];
  const liveAuthoritativePieces: RacePiece[] = [
    { id: 'attacker-1', ownerId: 'blue', nodeId: destinationNodeId, started: true, finished: false },
    { id: 'target-1', ownerId: 'red', nodeId: 'n01', started: false, finished: false },
  ];

  assert.deepEqual(
    capturablePieces(liveAuthoritativePieces, destinationNodeId, 'blue'),
    [],
    'authoritative echo has already removed the opponent from the destination',
  );

  const capturedIds = capturablePieces(moveStartSnapshot, destinationNodeId, 'blue').map((piece) => piece.id);
  assert.deepEqual(capturedIds, ['target-1']);

  let presentationCount = 0;
  if (capturedIds.length > 0) presentationCount += 1;
  assert.equal(presentationCount, 1);
  assert.equal((movePieceSource.match(/setCaptureEffect\(effect\);/g) ?? []).length, 1);
});
