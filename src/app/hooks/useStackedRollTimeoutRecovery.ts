import { useEffect, useRef } from 'react';
import type { BoardPiece } from '../../features/game/components/GameBoard';
import { commitCoordinatorMoveTimeoutRecovery } from '../../features/room/services/coordinatorMoveTimeoutRecovery';
import {
  MOVE_TIMEOUT_RECOVERY_RETRY_DELAY_MS,
  canRetryMoveTimeoutRecovery,
  classifyMoveTimeoutRecoveryResult,
  getMoveTimeoutRecoverySchedule,
  isMoveTimeoutRecoveryScopeCurrent,
  type MoveTimeoutRecoveryDisposition,
  type MoveTimeoutRecoveryScope,
} from '../../features/room/services/moveTimeoutRecoveryPolicy';
import {
  makeTimeoutActionKey,
  resolveMoveTimeout,
  resolveMoveTimeoutContext,
} from '../../features/room/services/timeoutResolvers';
import { BRANCH_NODE_IDS } from '../../game-core/board/board';
import type { YutResult } from '../../game-core/roll';
import { STORAGE_KEYS, type Seat } from '../appState';

type StackedRollTimeoutRecoveryParams = {
  activeSeat: Seat | undefined;
  coordinatorEpoch: number;
  hasBackDoMovablePiece: boolean;
  localSeatId: string;
  movingPieceId: string;
  onlineGameCoordinatorSeatId: string;
  pendingTrapPlacement: boolean;
  pieces: BoardPiece[];
  playMode: 'individual' | 'team';
  roll: YutResult | null;
  rollAnimationActive: boolean;
  rollResultHolding: boolean;
  rollStack: YutResult[];
  rollStackClosed: boolean;
  selectedPieceId: string;
  selectedRollStackIndex: number | null;
  seats: Seat[];
  spectators: Seat[];
  turnDeadlineAt: number;
  turnDeadlineKind: 'roll' | 'move' | 'item_prompt' | 'trap_placement' | '';
  turnOrderBlocked: boolean;
  winner: string;
};

const getActorLogPayload = (seat: Seat) => ({
  actorLabel: seat.label,
  actorName: seat.name,
  actorLogName: seat.label && seat.name ? `${seat.label}-${seat.name}` : seat.name || seat.label || seat.id,
});

/**
 * Coordinator fallback for every authoritative move timeout context.
 *
 * - A normal roll is recovered without a stack index.
 * - A selected stacked roll keeps its selected index.
 * - A closed unselected stack consumes its first selectable result.
 *
 * Manual input remains blocked after the deadline. This hook only submits after
 * the authoritative deadline plus network grace and never relies on the UI's
 * deadline-leading callback for correctness.
 */
export function useStackedRollTimeoutRecovery({
  activeSeat,
  coordinatorEpoch,
  hasBackDoMovablePiece,
  localSeatId,
  movingPieceId,
  onlineGameCoordinatorSeatId,
  pendingTrapPlacement,
  pieces,
  playMode,
  roll,
  rollAnimationActive,
  rollResultHolding,
  rollStack,
  rollStackClosed,
  selectedPieceId,
  selectedRollStackIndex,
  seats,
  spectators,
  turnDeadlineAt,
  turnDeadlineKind,
  turnOrderBlocked,
  winner,
}: StackedRollTimeoutRecoveryParams) {
  const inFlightActionKeyRef = useRef('');
  const completedActionKeysRef = useRef<Set<string>>(new Set());
  const stoppedAttemptKeysRef = useRef<Set<string>>(new Set());
  const retryAttemptsByScopeRef = useRef<Map<string, number>>(new Map());
  const roomId = typeof window === 'undefined'
    ? ''
    : window.localStorage.getItem(STORAGE_KEYS.activeRoomId) ?? '';
  const currentScope: MoveTimeoutRecoveryScope = {
    roomId,
    actorId: activeSeat?.id ?? '',
    turnDeadlineKind,
    turnDeadlineAt,
    coordinatorSeatId: onlineGameCoordinatorSeatId,
    coordinatorEpoch,
  };
  const latestScopeRef = useRef<MoveTimeoutRecoveryScope>(currentScope);
  latestScopeRef.current = currentScope;

  useEffect(() => {
    if (typeof window === 'undefined'
      || !activeSeat
      || !roomId
      || !localSeatId
      || localSeatId !== onlineGameCoordinatorSeatId
      || !Number.isFinite(coordinatorEpoch)
      || coordinatorEpoch <= 0
      || winner
      || turnOrderBlocked
      || pendingTrapPlacement
      || movingPieceId
      || rollAnimationActive
      || rollResultHolding
      || turnDeadlineKind !== 'move'
      || !Number.isFinite(turnDeadlineAt)
      || turnDeadlineAt <= 0
      || spectators.some((seat) => seat.id === localSeatId)
      || !seats.some((seat) => seat.id === localSeatId)) return undefined;

    const hasStackedMoveState = rollStack.length > 0
      || selectedRollStackIndex !== null
      || (roll === null && rollStackClosed);
    if (!roll && (!rollStackClosed || rollStack.length === 0)) return undefined;

    const timeoutContext = resolveMoveTimeoutContext({
      stackedRollMode: hasStackedMoveState,
      roll,
      rollStack,
      rollStackClosed,
      selectedRollStackIndex,
      hasBackDoMovablePiece,
    });
    if (!timeoutContext.roll) return undefined;
    if (hasStackedMoveState && timeoutContext.rollStackIndex === null) return undefined;

    const isSameSide = (leftOwnerId: string, rightOwnerId: string) => {
      if (playMode !== 'team') return leftOwnerId === rightOwnerId;
      const leftSeat = seats.find((seat) => seat.id === leftOwnerId);
      const rightSeat = seats.find((seat) => seat.id === rightOwnerId);
      return Boolean(leftSeat && rightSeat && leftSeat.team === rightSeat.team);
    };
    const timeoutMove = resolveMoveTimeout({
      pieces,
      selectedPieceId,
      steps: timeoutContext.steps,
      canControlPiece: (piece) => isSameSide(activeSeat.id, piece.ownerId),
      isSameSidePiece: (piece, selected) => isSameSide(piece.ownerId, selected.ownerId),
      branchChoice: 'outer',
    });
    if (timeoutMove.reason === 'pass' && timeoutContext.steps >= 0) return undefined;

    const targetPiece = timeoutMove.pieceId
      ? pieces.find((piece) => piece.id === timeoutMove.pieceId)
      : undefined;
    const needsBranchChoice = Boolean(
      targetPiece
      && timeoutContext.steps > 0
      && targetPiece.started
      && BRANCH_NODE_IDS.includes(targetPiece.nodeId as typeof BRANCH_NODE_IDS[number]),
    );
    if (needsBranchChoice) return undefined;

    const actionKey = makeTimeoutActionKey({
      roomId,
      stage: 'move',
      actorId: activeSeat.id,
      timeoutDeadlineAt: turnDeadlineAt,
    });
    const attemptScopeKey = `${actionKey}:${onlineGameCoordinatorSeatId}:${coordinatorEpoch}`;
    if (completedActionKeysRef.current.has(actionKey)
      || stoppedAttemptKeysRef.current.has(attemptScopeKey)) return undefined;

    const expectedScope: MoveTimeoutRecoveryScope = {
      roomId,
      actorId: activeSeat.id,
      turnDeadlineKind: 'move',
      turnDeadlineAt,
      coordinatorSeatId: onlineGameCoordinatorSeatId,
      coordinatorEpoch,
    };
    const { recoveryAt, delayMs } = getMoveTimeoutRecoverySchedule(turnDeadlineAt);
    const recoveryReason = roll === null
      ? 'stacked-roll-selection-timeout'
      : 'stalled-roll-move-timeout';
    const action = {
      type: 'move_piece' as const,
      actorId: activeSeat.id,
      payload: {
        pieceId: timeoutMove.reason === 'pass' ? '' : timeoutMove.pieceId,
        extraSteps: 0,
        branchChoice: timeoutMove.branchChoice,
        rollStackIndex: timeoutContext.rollStackIndex,
        clientActionId: actionKey,
        recoveredByCoordinator: true,
        coordinatorSeatId: onlineGameCoordinatorSeatId,
        coordinatorEpoch,
        reason: recoveryReason,
        stalledForMs: Math.max(0, recoveryAt - turnDeadlineAt),
        timeoutDeadlineAt: turnDeadlineAt,
        ...getActorLogPayload(activeSeat),
      },
    };

    let cancelled = false;
    let timer: number | null = null;

    const clearInFlight = () => {
      if (inFlightActionKeyRef.current === actionKey) inFlightActionKeyRef.current = '';
    };
    const schedule = (nextDelayMs: number) => {
      if (cancelled) return;
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(runRecovery, Math.max(0, nextDelayMs));
    };
    const stopCurrentAttemptScope = (message: string, disposition: MoveTimeoutRecoveryDisposition) => {
      stoppedAttemptKeysRef.current.add(attemptScopeKey);
      retryAttemptsByScopeRef.current.delete(attemptScopeKey);
      console.warn('[move-timeout-recovery] recovery stopped', {
        actionKey,
        attemptScopeKey,
        disposition,
        message,
      });
    };
    const scheduleRetry = (disposition: MoveTimeoutRecoveryDisposition, message: string) => {
      const attempt = retryAttemptsByScopeRef.current.get(attemptScopeKey) ?? 0;
      if (!canRetryMoveTimeoutRecovery(disposition, attempt)) {
        stopCurrentAttemptScope(message, disposition);
        return;
      }
      const nextAttempt = attempt + 1;
      retryAttemptsByScopeRef.current.set(attemptScopeKey, nextAttempt);
      const currentSchedule = getMoveTimeoutRecoverySchedule(turnDeadlineAt);
      const retryDelayMs = disposition === 'too-early'
        ? Math.max(currentSchedule.delayMs, MOVE_TIMEOUT_RECOVERY_RETRY_DELAY_MS)
        : MOVE_TIMEOUT_RECOVERY_RETRY_DELAY_MS * nextAttempt;
      schedule(retryDelayMs);
    };
    const runRecovery = () => {
      timer = null;
      if (cancelled
        || completedActionKeysRef.current.has(actionKey)
        || stoppedAttemptKeysRef.current.has(attemptScopeKey)) return;
      if (!isMoveTimeoutRecoveryScopeCurrent(expectedScope, latestScopeRef.current)) return;

      const currentSchedule = getMoveTimeoutRecoverySchedule(turnDeadlineAt);
      if (!currentSchedule.ready) {
        schedule(currentSchedule.delayMs);
        return;
      }
      if (inFlightActionKeyRef.current === actionKey) return;
      inFlightActionKeyRef.current = actionKey;

      void commitCoordinatorMoveTimeoutRecovery(roomId, action).then((result) => {
        const disposition = classifyMoveTimeoutRecoveryResult(result);
        if (disposition === 'terminal') {
          completedActionKeysRef.current.add(actionKey);
          retryAttemptsByScopeRef.current.delete(attemptScopeKey);
          clearInFlight();
          return;
        }
        clearInFlight();
        if (cancelled) return;
        scheduleRetry(disposition, result.reason ?? 'coordinator 이동 timeout recovery가 거부되었습니다.');
      }).catch((error) => {
        clearInFlight();
        if (cancelled) return;
        scheduleRetry(
          'retryable-state',
          error instanceof Error ? error.message : 'coordinator 이동 timeout recovery 네트워크 오류',
        );
      });
    };

    schedule(delayMs);

    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
      clearInFlight();
    };
  }, [
    activeSeat,
    coordinatorEpoch,
    hasBackDoMovablePiece,
    localSeatId,
    movingPieceId,
    onlineGameCoordinatorSeatId,
    pendingTrapPlacement,
    pieces,
    playMode,
    roll,
    rollAnimationActive,
    rollResultHolding,
    rollStack,
    rollStackClosed,
    roomId,
    selectedPieceId,
    selectedRollStackIndex,
    seats,
    spectators,
    turnDeadlineAt,
    turnDeadlineKind,
    turnOrderBlocked,
    winner,
  ]);
}
