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
  getTrustedManualMoveReservationContext,
  getTrustedManualMoveReservationContextFromAction,
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
const serverTimestampAt = (millis: number) => ({ toMillis: () => millis });
const reservation = {
  reservationType: 'manual_move',
  processed: true,
  actorId,
  clientActionId: `move_piece:${actorId}:17:1:piece-1:yut`,
  clientActionStartedAt: 19_500,
  expectedPreviousSequence: 17,
  expectedTurnIndex: 1,
  expiresAt: 25_000,
  createdAt: serverTimestampAt(19_750),
};
const manualAction = {
  type: 'move_piece',
  actorId,
  payload: {
    clientActionId: reservation.clientActionId,
    clientActionStartedAt: reservation.clientActionStartedAt,
  },
};

test('수동 이동 식별자는 actor 뒤 authoritative sequence와 turn을 추출한다', () => {
  assert.deepEqual(getManualMoveActionIdentity(manualAction), {
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

test('coordinator timeout deadline과 수동 reservation transaction read marker를 구분한다', () => {
  assert.equal(getCoordinatorTimeoutDeadlineAt({
    type: 'move_piece',
    actorId,
    payload: { recoveredByCoordinator: true, timeoutDeadlineAt },
  }), timeoutDeadlineAt);
  assert.ok(getCoordinatorTimeoutDeadlineAt(manualAction) < 0);
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

test('서버가 deadline 전에 받은 같은 actor·sequence·turn reservation만 timeout을 보류한다', () => {
  assert.equal(isActiveManualMoveReservation({ reservation, actorId, timeoutDeadlineAt, state, now }), true);
  assert.equal(isActiveManualMoveReservation({
    reservation: { ...reservation, expiresAt: 1 },
    actorId,
    timeoutDeadlineAt,
    state,
    now,
  }), true, 'client expiresAt이 아니라 server timestamp 기반 TTL을 사용해야 합니다.');

  const invalidCases: Array<{
    reservation?: Record<string, unknown>;
    state?: typeof state;
    receivedAt?: number;
  }> = [
    { reservation: { ...reservation, actorId: 'other-player' } },
    { reservation: { ...reservation, clientActionStartedAt: timeoutDeadlineAt + 1 } },
    { reservation: { ...reservation, createdAt: serverTimestampAt(timeoutDeadlineAt + 1) } },
    { reservation: { ...reservation, createdAt: timeoutDeadlineAt - 1 } },
    { reservation: { ...reservation, expectedPreviousSequence: 18 } },
    { reservation: { ...reservation, expectedTurnIndex: 0 } },
    { state: { ...state, turnDeadlineKind: 'roll' } },
    { state: { ...state, turnDeadlineAt: timeoutDeadlineAt + 1 } },
    { receivedAt: 19_750 + MANUAL_MOVE_RESERVATION_TTL_MS },
  ];

  for (const invalid of invalidCases) {
    assert.equal(isActiveManualMoveReservation({
      reservation: invalid.reservation ?? reservation,
      actorId,
      timeoutDeadlineAt,
      state: invalid.state ?? state,
      now: invalid.receivedAt ?? now,
    }), false);
  }
});

test('manual transaction은 exact reservation을 reducer가 한 번만 소비할 trusted context로 연결한다', () => {
  const reservationReadMarker = getCoordinatorTimeoutDeadlineAt(manualAction);
  assert.ok(reservationReadMarker < 0);
  assert.equal(isActiveManualMoveReservation({
    reservation,
    actorId,
    timeoutDeadlineAt: reservationReadMarker,
    state,
    now,
  }), false, '수동 action은 timeout 보류 결과를 반환하지 않고 transaction을 계속해야 합니다.');

  assert.deepEqual(getTrustedManualMoveReservationContextFromAction(manualAction), {
    actorId,
    clientActionId: reservation.clientActionId,
    clientActionStartedAt: reservation.clientActionStartedAt,
    expectedPreviousSequence: 17,
    expectedTurnIndex: 1,
    deadlineAt: timeoutDeadlineAt,
    serverReceivedAt: 19_750,
    expiresAt: 19_750 + MANUAL_MOVE_RESERVATION_TTL_MS,
  });
  assert.equal(getTrustedManualMoveReservationContextFromAction(manualAction), null);
});

test('exact action ID·start·state가 다르거나 forged payload만 있으면 trusted context가 생기지 않는다', () => {
  assert.equal(getTrustedManualMoveReservationContext({
    reservation,
    action: {
      ...manualAction,
      payload: { ...manualAction.payload, clientActionStartedAt: 19_499 },
    },
    state,
    now,
  }), null);
  assert.equal(getTrustedManualMoveReservationContext({
    reservation,
    action: {
      ...manualAction,
      payload: { ...manualAction.payload, clientActionId: `${reservation.clientActionId}:forged` },
    },
    state,
    now,
  }), null);
  assert.equal(getTrustedManualMoveReservationContextFromAction({
    ...manualAction,
    payload: {
      ...manualAction.payload,
      trustedManualMoveReservation: true,
      reservationVerified: true,
    },
  }), null);
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
  const transactionStart = source.indexOf('return runTransaction(firestore, async (transaction)', reservationRef);
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

test('manual authoritative transaction은 reservation read 뒤 reducer가 private context를 소비한다', () => {
  const coreSource = readFileSync('src/features/room/services/roomServiceCore.ts', 'utf8');
  const reducerSource = readFileSync('src/features/room/services/roomAuthoritativeReducer.ts', 'utf8');
  const policySource = readFileSync('src/features/room/services/manualMoveReservationPolicy.ts', 'utf8');
  const functionStart = coreSource.indexOf('export async function commitAuthoritativeGameAction');
  const marker = coreSource.indexOf('getCoordinatorTimeoutDeadlineAt(action)', functionStart);
  const reservationRef = coreSource.indexOf('const manualMoveReservationRef = timeoutDeadlineAt', marker);
  const transactionStart = coreSource.indexOf('return runTransaction(db, async (transaction)', reservationRef);
  const stateRead = coreSource.indexOf('await transaction.get(gameStateRef)', transactionStart);
  const reservationRead = coreSource.indexOf('await transaction.get(manualMoveReservationRef)', stateRead);
  const reservationDecision = coreSource.indexOf('isActiveManualMoveReservation({', reservationRead);
  const reducer = coreSource.indexOf('reduceAuthoritativeGameAction(state, action, room, actionSides)', reservationDecision);
  const trustedContextRead = reducerSource.indexOf('getTrustedManualMoveReservationContextFromAction(action)');
  const localDeadlineBypass = reducerSource.indexOf('clientActionStartedAt: 0', trustedContextRead);
  const implementationCall = reducerSource.indexOf('reduceAuthoritativeGameActionImplementation(reductionState, reductionAction', localDeadlineBypass);

  assert.ok(functionStart >= 0);
  assert.ok(marker > functionStart);
  assert.ok(reservationRef > marker);
  assert.ok(transactionStart > reservationRef);
  assert.ok(stateRead > transactionStart);
  assert.ok(reservationRead > stateRead);
  assert.ok(reservationDecision > reservationRead);
  assert.ok(reducer > reservationDecision);
  assert.ok(trustedContextRead >= 0);
  assert.ok(localDeadlineBypass > trustedContextRead);
  assert.ok(implementationCall > localDeadlineBypass);
  assert.match(policySource, /const pendingTrustedManualMoveReservations = new Map/);
  assert.match(policySource, /pendingTrustedManualMoveReservations\.delete\(clientActionId\)/);
  assert.doesNotMatch(policySource, /action\.payload\?\.(trustedManualMoveReservation|reservationVerified)/);
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
