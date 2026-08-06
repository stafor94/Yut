import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  AUTHORITATIVE_COMMIT_RECOVERY_TIMEOUT_MS,
  AUTHORITATIVE_COMMIT_TIMEOUT_MS,
} from '../../src/features/room/services/authoritativeCommitTimeout';
import {
  getCoordinatorTimeoutDeadlineAt,
  getManualMoveActionIdentity,
  isActiveManualMoveReservation,
  MANUAL_MOVE_RESERVATION_TTL_MS,
} from '../../src/features/room/services/manualMoveReservationPolicy';

const actorId = 'guest-player';
const timeoutDeadlineAt = 20_000;
const now = 20_500;
const state = {
  lastSequence: 17,
  turnIndex: 1,
  turnDeadlineAt: timeoutDeadlineAt,
  turnDeadlineKind: 'move',
};
const reservation = {
  reservationType: 'manual_move',
  processed: true,
  actorId,
  clientActionId: `move_piece:${actorId}:17:1:piece-1:yut`,
  clientActionStartedAt: 19_500,
  expectedPreviousSequence: 17,
  expectedTurnIndex: 1,
  expiresAt: 25_000,
};

test('수동 이동 식별자는 actor 뒤 authoritative sequence와 turn을 추출한다', () => {
  assert.deepEqual(getManualMoveActionIdentity({
    type: 'move_piece',
    actorId,
    payload: { clientActionId: reservation.clientActionId },
  }), {
    expectedPreviousSequence: 17,
    expectedTurnIndex: 1,
  });

  for (const clientActionId of [
    `move_piece:${actorId}::1:piece-1:yut`,
    `move_piece:${actorId}:17:x:piece-1:yut`,
    `move_piece:other-player:17:1:piece-1:yut`,
  ]) {
    assert.equal(getManualMoveActionIdentity({ type: 'move_piece', actorId, payload: { clientActionId } }), null);
  }
});

test('coordinator timeout 이동만 authoritative deadline을 노출한다', () => {
  assert.equal(getCoordinatorTimeoutDeadlineAt({
    type: 'move_piece',
    actorId,
    payload: { recoveredByCoordinator: true, timeoutDeadlineAt },
  }), timeoutDeadlineAt);
  assert.equal(getCoordinatorTimeoutDeadlineAt({
    type: 'move_piece',
    actorId,
    payload: { timeoutDeadlineAt },
  }), 0);
  assert.equal(getCoordinatorTimeoutDeadlineAt({
    type: 'roll_yut',
    actorId,
    payload: { recoveredByCoordinator: true, timeoutDeadlineAt },
  }), 0);
});

test('같은 actor·sequence·turn·deadline의 미만료 선행 수동 이동만 timeout을 보류한다', () => {
  assert.equal(isActiveManualMoveReservation({ reservation, actorId, timeoutDeadlineAt, state, now }), true);

  const invalidCases: Array<{
    reservation?: typeof reservation;
    state?: typeof state;
  }> = [
    { reservation: { ...reservation, actorId: 'other-player' } },
    { reservation: { ...reservation, clientActionStartedAt: timeoutDeadlineAt + 1 } },
    { reservation: { ...reservation, expiresAt: now } },
    { reservation: { ...reservation, expectedPreviousSequence: 18 } },
    { reservation: { ...reservation, expectedTurnIndex: 0 } },
    { state: { ...state, turnDeadlineKind: 'roll' } },
    { state: { ...state, turnDeadlineAt: timeoutDeadlineAt + 1 } },
  ];

  for (const invalid of invalidCases) {
    assert.equal(isActiveManualMoveReservation({
      reservation: invalid.reservation ?? reservation,
      actorId,
      timeoutDeadlineAt,
      state: invalid.state ?? state,
      now,
    }), false);
  }
});

test('reservation TTL은 commit timeout과 recovery가 끝날 때까지 유지된다', () => {
  assert.ok(MANUAL_MOVE_RESERVATION_TTL_MS > (
    AUTHORITATIVE_COMMIT_TIMEOUT_MS + AUTHORITATIVE_COMMIT_RECOVERY_TIMEOUT_MS
  ));
});

test('coordinator timeout은 state와 reservation을 읽고 같은 transaction에서 reduce·commit한다', () => {
  const source = readFileSync('src/features/room/services/coordinatorMoveTimeoutRecovery.ts', 'utf8');
  const functionStart = source.indexOf('export async function commitCoordinatorMoveTimeoutRecovery');
  const reservationRef = source.indexOf('getManualMoveReservationKey(roomId, action.actorId)', functionStart);
  const transactionStart = source.indexOf('return runTransaction(db, async (transaction)', reservationRef);
  const stateRead = source.indexOf('await transaction.get(gameStateRef)', transactionStart);
  const reservationRead = source.indexOf('await transaction.get(manualMoveReservationRef)', stateRead);
  const reservationDecision = source.indexOf('isActiveManualMoveReservation({', reservationRead);
  const reservationRejection = source.indexOf('MOVE_RESERVATION_REEVALUATE_REASON', reservationDecision);
  const reducer = source.indexOf('reduceAuthoritativeGameAction(state, action', reservationRejection);
  const sequenceWrite = source.indexOf('transaction.set(sequenceRef', reducer);
  const stateWrite = source.indexOf('transaction.set(gameStateRef', sequenceWrite);

  assert.ok(functionStart >= 0);
  assert.ok(reservationRef > functionStart);
  assert.ok(transactionStart > reservationRef);
  assert.ok(stateRead > transactionStart);
  assert.ok(reservationRead > stateRead);
  assert.ok(reservationDecision > reservationRead);
  assert.ok(reservationRejection > reservationDecision);
  assert.ok(reducer > reservationRejection);
  assert.ok(sequenceWrite > reducer);
  assert.ok(stateWrite > sequenceWrite);
  assert.doesNotMatch(source, /\bgetLatestGameState\b|\bsaveGameState\b/);
});

test('wrapper는 reservation 게시 뒤 기존 presentation commit wiring과 TTL 수명을 보존한다', () => {
  const roomServiceSource = readFileSync('src/features/room/services/roomService.ts', 'utf8');
  const qaDelaySource = readFileSync('src/features/room/services/roomQaDelays.ts', 'utf8');
  const reservationPublish = roomServiceSource.indexOf('await setDoc(reservationRef');
  const settleStart = roomServiceSource.indexOf('return settleAuthoritativeCommit({', reservationPublish);
  const commitStart = roomServiceSource.indexOf('commit: async () => {', settleStart);
  const presentationWait = roomServiceSource.indexOf('await waitForGamePresentationBeforeAction', commitStart);
  const coreCommit = roomServiceSource.indexOf('return commitAuthoritativeGameActionCore', presentationWait);

  assert.ok(reservationPublish >= 0);
  assert.ok(settleStart > reservationPublish);
  assert.ok(commitStart > settleStart);
  assert.ok(presentationWait > commitStart);
  assert.ok(coreCommit > presentationWait);
  assert.doesNotMatch(roomServiceSource, /readActiveManualMoveReservation/);
  assert.doesNotMatch(roomServiceSource, /deleteDoc\(reservationRef\)/);
  assert.doesNotMatch(qaDelaySource, /\bwindow\b|\bdocument\b|import\.meta/);
});
