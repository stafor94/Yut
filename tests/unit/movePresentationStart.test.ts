import assert from 'node:assert/strict';
import test from 'node:test';
import { commitAcceptedMovePresentation, prepareMovePresentationStart } from '../../src/app/flows/movePresentationStart.ts';

type Piece = { id: string; ownerId: string; started: boolean; finished: boolean };

const makePiece = (overrides: Partial<Piece> = {}): Piece => ({
  id: 'human-piece-1',
  ownerId: 'human',
  started: false,
  finished: false,
  ...overrides,
});

function createSubmissionHarness() {
  const counters = {
    pending: 0,
    mutationIds: 0,
    authoritativeEnqueue: 0,
    ledgerClaims: 0,
    presentationStarts: 0,
  };
  let moveInProgress = false;
  let pieces = [makePiece()];

  const submit = ({ blocker = '', startFailure = '' } = {}) => {
    if (blocker === 'move-in-progress') moveInProgress = true;
    if (blocker !== 'move-in-progress' && moveInProgress) moveInProgress = false;
    if (blocker === 'piece-not-found') pieces = [];
    else if (blocker === 'piece-not-controllable') pieces = [makePiece({ ownerId: 'other' })];
    else pieces = [makePiece()];

    const preparation = prepareMovePresentationStart({
      winner: false,
      movingPieceId: '',
      moveInProgress,
      pieces,
      pieceId: 'human-piece-1',
      steps: 2,
      canControlPiece: (piece) => piece.ownerId === 'human',
      prepare: (piece) => ({ pieceId: piece.id }),
      acquireExecution: () => {
        if (moveInProgress) return false;
        moveInProgress = true;
        return true;
      },
    });
    if (!preparation.accepted) return false;

    const presentation = commitAcceptedMovePresentation({
      prepared: preparation.prepared,
      registerOwnership: () => {
        counters.pending += 1;
        counters.mutationIds += 1;
        counters.ledgerClaims += 1;
        return true;
      },
      startPresentation: () => {
        if (startFailure) return { started: false as const, reason: startFailure };
        counters.presentationStarts += 1;
        return { started: true as const, completion: Promise.resolve(true) };
      },
      rollbackOwnership: () => {
        counters.pending -= 1;
        counters.mutationIds -= 1;
        counters.ledgerClaims -= 1;
      },
      releaseExecution: () => { moveInProgress = false; },
    });
    if (!presentation.started) return false;
    counters.authoritativeEnqueue += 1;
    return true;
  };

  return { counters, submit };
}

for (const blocker of ['move-in-progress', 'piece-not-found', 'piece-not-controllable'] as const) {
  test(`start rejection ${blocker} leaves no remote ownership and can retry`, () => {
    const harness = createSubmissionHarness();
    assert.equal(harness.submit({ blocker }), false);
    assert.deepEqual(harness.counters, {
      pending: 0,
      mutationIds: 0,
      authoritativeEnqueue: 0,
      ledgerClaims: 0,
      presentationStarts: 0,
    });
    assert.equal(harness.submit(), true);
    assert.deepEqual(harness.counters, {
      pending: 1,
      mutationIds: 1,
      authoritativeEnqueue: 1,
      ledgerClaims: 1,
      presentationStarts: 1,
    });
  });
}

test('presentation start failure rolls back only the accepted action before enqueue', () => {
  const harness = createSubmissionHarness();
  assert.equal(harness.submit({ startFailure: 'synthetic-start-failure' }), false);
  assert.deepEqual(harness.counters, {
    pending: 0,
    mutationIds: 0,
    authoritativeEnqueue: 0,
    ledgerClaims: 0,
    presentationStarts: 0,
  });
  assert.equal(harness.submit(), true);
});
