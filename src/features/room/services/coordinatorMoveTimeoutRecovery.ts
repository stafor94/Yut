import {
  isAuthoritativeCommitReduction,
  reduceAuthoritativeGameAction,
  type AuthoritativeSeatSide,
} from './roomAuthoritativeReducer';
import {
  getLatestGameState,
  hasAuthoritativeGameConfigSnapshot,
  saveGameState,
  type CommitAuthoritativeGameActionResult,
  type GameAction,
  type SyncedGameState,
} from './roomServiceCore';

export type CoordinatorMoveTimeoutAction = Omit<GameAction, 'id' | 'createdAt' | 'processed'> & {
  type: 'move_piece';
};

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

/**
 * The reducer validates actor, deadline, grace, and stack index. saveGameState
 * then validates the current coordinator lease, expected sequence, and stable
 * processed action key before committing the recovery atomically.
 */
export async function commitCoordinatorMoveTimeoutRecovery(
  roomId: string,
  action: CoordinatorMoveTimeoutAction,
): Promise<CommitAuthoritativeGameActionResult> {
  const clientActionId = getRecoveryClientActionId(action);
  const timeoutDeadlineAt = Number(action.payload?.timeoutDeadlineAt ?? 0);
  const coordinatorEpoch = Number(action.payload?.coordinatorEpoch ?? 0);
  if (!roomId
    || action.payload?.recoveredByCoordinator !== true
    || !clientActionId
    || !Number.isFinite(timeoutDeadlineAt)
    || timeoutDeadlineAt <= 0
    || typeof action.payload?.coordinatorSeatId !== 'string'
    || !action.payload.coordinatorSeatId
    || !Number.isFinite(coordinatorEpoch)
    || coordinatorEpoch <= 0) {
    return { status: 'rejected', reason: 'coordinator 이동 timeout recovery 정보가 올바르지 않습니다.' };
  }

  const state = await getLatestGameState(roomId);
  if (!state) return { status: 'rejected', reason: '아직 게임 상태가 준비되지 않았습니다.' };
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

  const currentSequence = Number(state.lastSequence ?? 0);
  const stateAfter: SyncedGameState = {
    ...state,
    ...reduction.patch,
  };
  const { updatedAt: _updatedAt, turnVersion: _turnVersion, ...stateForSave } = stateAfter;
  const saveResult = await saveGameState(roomId, stateForSave, {
    type: 'move_piece_resolved',
    actorId: action.actorId,
    coordinatorSeatId: action.payload.coordinatorSeatId,
    coordinatorEpoch,
    payload: reduction.payload,
    action,
    clientMutationId: clientActionId,
    clientCreatedAt: Date.now(),
    expectedPreviousSequence: currentSequence,
  });

  if (saveResult.status === 'committed') {
    return {
      status: 'committed',
      sequence: saveResult.lastSequence,
      turnVersion: saveResult.turnVersion,
      patch: reduction.patch,
      payload: reduction.payload,
      stateAfter,
    };
  }
  if (saveResult.status === 'duplicate') {
    return {
      status: 'duplicate',
      sequence: saveResult.lastSequence,
      turnVersion: saveResult.turnVersion,
    };
  }
  if (saveResult.status === 'lease_mismatch') {
    return { status: 'rejected', reason: 'coordinator lease가 만료되었거나 epoch가 일치하지 않습니다.' };
  }
  if (saveResult.status === 'sequence_mismatch') {
    return { status: 'rejected', reason: 'authoritative sequence가 변경되어 최신 상태 재평가가 필요합니다.' };
  }
  return { status: 'rejected', reason: 'coordinator 이동 timeout recovery를 저장할 수 없습니다.' };
}
