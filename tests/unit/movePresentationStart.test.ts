import assert from 'node:assert/strict';
import test from 'node:test';
import { commitAcceptedMovePresentation, prepareMovePresentationStart } from '../../src/app/flows/movePresentationStart.js';

type Piece = { id: string; ownerId: string; started: boolean; finished: boolean };
type ExactAction = { type: 'move_piece'; actorId: string; payload: { clientActionId: string; clientActionStartedAt: number; pieceId: string } };

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
  let submittedAction: ExactAction | null = null;
  let ownershipAction: ExactAction | null = null;
  let enqueuedAction: ExactAction | null = null;
  let actionSerial = 0;

  const submit = ({ blocker = '', startFailure = '', ownershipFailure = false } = {}) => {
    if (blocker === 'move-in-progress') moveInProgress = true;
    if (blocker !== 'move-in-progress' && moveInProgress) moveInProgress = false;
    if (blocker === 'piece-not-found') pieces = [];
    else if (blocker === 'piece-not-controllable') pieces = [makePiece({ ownerId: 'other' })];
    else pieces = [makePiece()];

    actionSerial += 1;
    const action: ExactAction = {
      type: 'move_piece',
      actorId: 'human',
      payload: {
        clientActionId: `move-piece-${actionSerial}`,
        clientActionStartedAt: 1_000 + actionSerial,
        pieceId: 'human-piece-1',
      },
    };
    submittedAction = action;

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
        ownershipAction = action;
        return !ownershipFailure;
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
        ownershipAction = null;
      },
      releaseExecution: () => { moveInProgress = false; },
    });
    if (!presentation.started) return false;
    counters.authoritativeEnqueue += 1;
    enqueuedAction = action;
    return true;
  };

  return {
    counters,
    submit,
    get submittedAction() { return submittedAction; },
    get ownershipAction() { return ownershipAction; },
    get enqueuedAction() { return enqueuedAction; },
  };
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

test('성공 시 pending/ledger/presentation/enqueue가 각각 한 번이고 exact same action identity를 사용한다', () => {
  const harness = createSubmissionHarness();
  assert.equal(harness.submit(), true);
  assert.deepEqual(harness.counters, {
    pending: 1,
    mutationIds: 1,
    authoritativeEnqueue: 1,
    ledgerClaims: 1,
    presentationStarts: 1,
  });
  assert.ok(harness.submittedAction);
  assert.equal(harness.ownershipAction, harness.submittedAction);
  assert.equal(harness.enqueuedAction, harness.submittedAction);
  assert.equal(harness.enqueuedAction?.payload.clientActionId, harness.ownershipAction?.payload.clientActionId);
  assert.equal(harness.enqueuedAction?.payload.clientActionStartedAt, harness.ownershipAction?.payload.clientActionStartedAt);
});

test('ownership registration failure는 pending/ledger/execution을 전부 rollback하고 즉시 재시도할 수 있다', () => {
  const harness = createSubmissionHarness();
  assert.equal(harness.submit({ ownershipFailure: true }), false);
  assert.deepEqual(harness.counters, {
    pending: 0,
    mutationIds: 0,
    authoritativeEnqueue: 0,
    ledgerClaims: 0,
    presentationStarts: 0,
  });
  assert.equal(harness.ownershipAction, null);

  assert.equal(harness.submit(), true);
  assert.deepEqual(harness.counters, {
    pending: 1,
    mutationIds: 1,
    authoritativeEnqueue: 1,
    ledgerClaims: 1,
    presentationStarts: 1,
  });
});

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
