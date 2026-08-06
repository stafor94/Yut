import { doc, runTransaction, serverTimestamp } from 'firebase/firestore';
import { auth } from '../../../services/firebase/firebaseAuth';
import { db } from '../../../services/firebase/firebaseDb';
import {
  isAuthoritativeCommitReduction,
  reduceAuthoritativeGameAction,
  type AuthoritativeSeatSide,
} from './roomAuthoritativeReducer';
import {
  hasAuthoritativeGameConfigSnapshot,
  makeSequenceEventFields,
  type CommitAuthoritativeGameActionResult,
  type GameAction,
  type GameSequence,
  type SyncedGameState,
} from './roomServiceCore';
import {
  getGameCoordinatorLeaseSnapshot,
  matchesActiveGameCoordinatorLease,
  normalizeCoordinatorEpoch,
} from './roomCoordinatorLease';
import {
  getClientMutationDocRef,
  makeFirestoreSafeId,
  makeSequenceDocId,
  sanitizeForFirestore,
} from './roomFirestore';
import {
  getManualMoveReservationKey,
  isActiveManualMoveReservation,
  MOVE_RESERVATION_REEVALUATE_REASON,
} from './manualMoveReservationPolicy';

export type CoordinatorMoveTimeoutAction = Omit<GameAction, 'id' | 'createdAt' | 'processed'> & {
  type: 'move_piece';
};

const MAX_CHECKPOINT_LOGS = 200;

const getAuthoritativeSides = (state: SyncedGameState): AuthoritativeSeatSide[] | null => {
  const turnOrderIds = state.turnOrderIds ?? [];
  if (turnOrderIds.length === 0) return null;
  const seatById = new Map((state.gameSeats ?? []).map((seat) => [seat.id, seat]));
  const sides = turnOrderIds.map((seatId) => {
    const seat = seatById.get(seatId);
    if (!seat || (seat.team !== '청팀' && seat.team !== '홍팀')) return null;
    return { id: seatId, team: seat.team } satisfies AuthoritativeSeatSide;
  });
  return sides.every(Boolean) ? sides as AuthoritativeSeatSide[] : null;
};

const getRecoveryClientActionId = (action: CoordinatorMoveTimeoutAction) => (
  typeof action.payload?.clientActionId === 'string' ? action.payload.clientActionId : ''
);

const makeFirestoreStateData = (state: SyncedGameState) => {
  const compactState = {
    ...state,
    logs: Array.isArray(state.logs) ? state.logs.slice(0, MAX_CHECKPOINT_LOGS) : state.logs,
  };
  delete compactState.updatedAt;
  delete compactState.coordinatorSeatId;
  delete compactState.coordinatorEpoch;
  delete compactState.coordinatorLeaseExpiresAt;
  delete compactState.coordinatorLeaseUpdatedAt;
  return sanitizeForFirestore(compactState) as Record<string, unknown>;
};

/**
 * Coordinator move timeout recovery reads the current state and matching manual
 * move reservation, reduces the action, and writes sequence/state in one
 * Firestore transaction. A pre-deadline manual reservation therefore cannot be
 * overtaken between validation and commit by another browser's coordinator.
 */
export async function commitCoordinatorMoveTimeoutRecovery(
  roomId: string,
  action: CoordinatorMoveTimeoutAction,
): Promise<CommitAuthoritativeGameActionResult> {
  const clientActionId = getRecoveryClientActionId(action);
  const timeoutDeadlineAt = Number(action.payload?.timeoutDeadlineAt ?? 0);
  const coordinatorSeatId = typeof action.payload?.coordinatorSeatId === 'string'
    ? action.payload.coordinatorSeatId
    : '';
  const coordinatorEpoch = normalizeCoordinatorEpoch(action.payload?.coordinatorEpoch);
  if (!db
    || !roomId
    || action.payload?.recoveredByCoordinator !== true
    || !clientActionId
    || !Number.isFinite(timeoutDeadlineAt)
    || timeoutDeadlineAt <= 0
    || !coordinatorSeatId
    || coordinatorEpoch <= 0) {
    return { status: 'rejected', reason: 'coordinator 이동 timeout recovery 정보가 올바르지 않습니다.' };
  }

  const gameStateRef = doc(db, 'rooms', roomId, 'state', 'current');
  const processedActionRef = getClientMutationDocRef(roomId, clientActionId);
  const manualMoveReservationRef = doc(
    db,
    'rooms',
    roomId,
    'actions',
    makeFirestoreSafeId(getManualMoveReservationKey(roomId, action.actorId)),
  );

  return runTransaction(db, async (transaction): Promise<CommitAuthoritativeGameActionResult> => {
    const processedActionSnapshot = await transaction.get(processedActionRef);
    if (processedActionSnapshot.exists()) {
      return {
        status: 'duplicate',
        sequence: Number(processedActionSnapshot.data().sequence ?? 0),
        turnVersion: Number(processedActionSnapshot.data().turnVersion ?? 0),
      };
    }

    const stateSnapshot = await transaction.get(gameStateRef);
    if (!stateSnapshot.exists()) return { status: 'rejected', reason: '아직 게임 상태가 준비되지 않았습니다.' };
    const state = stateSnapshot.data() as SyncedGameState;
    const currentVersion = Number(state.turnVersion ?? 0);
    const currentSequence = Number(state.lastSequence ?? 0);

    const manualMoveReservationSnapshot = await transaction.get(manualMoveReservationRef);
    if (manualMoveReservationSnapshot.exists()
      && isActiveManualMoveReservation({
        reservation: manualMoveReservationSnapshot.data(),
        actorId: action.actorId,
        timeoutDeadlineAt,
        state,
        now: Date.now(),
      })) {
      return { status: 'rejected', reason: MOVE_RESERVATION_REEVALUATE_REASON };
    }

    const coordinatorLease = { coordinatorSeatId, coordinatorEpoch };
    if ((auth && auth.currentUser?.uid !== coordinatorSeatId)
      || !matchesActiveGameCoordinatorLease(state, coordinatorLease, Date.now())) {
      return { status: 'rejected', reason: 'coordinator lease가 만료되었거나 epoch가 일치하지 않습니다.' };
    }
    if (!hasAuthoritativeGameConfigSnapshot(state)) {
      return { status: 'rejected', reason: 'authoritative 게임 설정 snapshot을 확인할 수 없습니다.' };
    }

    const sides = getAuthoritativeSides(state);
    if (!sides) return { status: 'rejected', reason: '게임 좌석 정보를 확인할 수 없습니다.' };

    const reduction = reduceAuthoritativeGameAction(state, action, {
      playMode: state.playMode,
      pieceCount: state.pieceCount,
      stackedRollMode: state.stackedRollMode,
    }, sides);
    if (!isAuthoritativeCommitReduction(reduction)) return reduction;

    const nextVersion = currentVersion + 1;
    const nextSequence = currentSequence + 1;
    const stateAfter: SyncedGameState = {
      ...state,
      ...reduction.patch,
      turnVersion: nextVersion,
      lastSequence: nextSequence,
      lastClientMutationId: clientActionId,
    };
    const sequenceRef = doc(db, 'rooms', roomId, 'sequences', makeSequenceDocId(nextSequence));
    const sequenceEvent: GameSequence = {
      id: makeSequenceDocId(nextSequence),
      sequence: nextSequence,
      type: 'move_piece_resolved',
      actorId: action.actorId,
      ...getGameCoordinatorLeaseSnapshot(state),
      payload: sanitizeForFirestore(reduction.payload) as Record<string, unknown>,
      ...makeSequenceEventFields({ stateBefore: state, stateAfter, patch: reduction.patch, action }),
      expectedPreviousSequence: currentSequence,
      clientMutationId: clientActionId,
      clientCreatedAt: Date.now(),
      createdAt: serverTimestamp(),
    };
    const { id: _sequenceEventId, ...sequenceEventData } = sequenceEvent;

    transaction.set(sequenceRef, sequenceEventData);
    transaction.set(gameStateRef, {
      ...makeFirestoreStateData(stateAfter),
      updatedAt: serverTimestamp(),
      turnVersion: nextVersion,
      lastSequence: nextSequence,
      lastClientMutationId: clientActionId,
    }, { merge: true });
    transaction.set(processedActionRef, {
      clientMutationId: clientActionId,
      sequence: nextSequence,
      turnVersion: nextVersion,
      type: 'move_piece_resolved',
      actorId: action.actorId,
      ...getGameCoordinatorLeaseSnapshot(state),
      createdAt: serverTimestamp(),
    });

    return {
      status: 'committed',
      sequence: nextSequence,
      turnVersion: nextVersion,
      patch: reduction.patch,
      payload: reduction.payload,
      stateAfter,
      sequenceEvent,
    };
  });
}
