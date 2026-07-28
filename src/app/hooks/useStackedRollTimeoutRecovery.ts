import { useEffect, useRef, useState } from 'react';
import type { BoardPiece } from '../../features/game/components/GameBoard';
import { commitCoordinatorMoveTimeoutRecovery } from '../../features/room/services/coordinatorMoveTimeoutRecovery';
import { getTurnRecoveryDeadlineAt } from '../../features/room/services/roomTiming';
import {
  makeTimeoutActionKey,
  resolveMoveTimeout,
  resolveMoveTimeoutContext,
} from '../../features/room/services/timeoutResolvers';
import { BRANCH_NODE_IDS } from '../../game-core/board/board';
import type { YutResult } from '../../game-core/roll';
import { STORAGE_KEYS, type Seat } from '../appState';

const RECOVERY_RETRY_DELAY_MS = 600;

type StackedRollTimeoutRecoveryParams = {
  activeSeat: Seat | undefined;
  coordinatorEpoch: number;
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
  stackedRollMode: boolean;
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
 * App's normal stalled-turn recovery owns every state with a current roll.
 * This hook covers the one authoritative gap where a closed stacked roll has
 * no local roll because the player never selected one before the deadline.
 */
export function useStackedRollTimeoutRecovery({
  activeSeat,
  coordinatorEpoch,
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
  stackedRollMode,
  turnDeadlineAt,
  turnDeadlineKind,
  turnOrderBlocked,
  winner,
}: StackedRollTimeoutRecoveryParams) {
  const [retryVersion, setRetryVersion] = useState(0);
  const inFlightLeaseKeyRef = useRef('');

  useEffect(() => {
    if (typeof window === 'undefined'
      || !activeSeat
      || !localSeatId
      || localSeatId !== onlineGameCoordinatorSeatId
      || !Number.isFinite(coordinatorEpoch)
      || coordinatorEpoch <= 0
      || !stackedRollMode
      || winner
      || turnOrderBlocked
      || pendingTrapPlacement
      || movingPieceId
      || rollAnimationActive
      || rollResultHolding
      || turnDeadlineKind !== 'move'
      || !Number.isFinite(turnDeadlineAt)
      || turnDeadlineAt <= 0
      || roll !== null
      || !rollStackClosed
      || rollStack.length === 0
      || spectators.some((seat) => seat.id === localSeatId)
      || !seats.some((seat) => seat.id === localSeatId)) return undefined;

    const roomId = window.localStorage.getItem(STORAGE_KEYS.activeRoomId) ?? '';
    if (!roomId) return undefined;

    const timeoutContext = resolveMoveTimeoutContext({
      stackedRollMode,
      roll,
      rollStack,
      rollStackClosed,
      selectedRollStackIndex,
    });
    if (!timeoutContext.roll || timeoutContext.rollStackIndex === null) return undefined;

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
    const leaseAttemptKey = `${actionKey}:${onlineGameCoordinatorSeatId}:${coordinatorEpoch}:${retryVersion}`;
    const recoveryAt = getTurnRecoveryDeadlineAt(turnDeadlineAt);
    let cancelled = false;
    let retryTimer: number | null = null;

    const timer = window.setTimeout(() => {
      if (cancelled || inFlightLeaseKeyRef.current === leaseAttemptKey) return;
      inFlightLeaseKeyRef.current = leaseAttemptKey;
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
          reason: 'stacked-roll-selection-timeout',
          stalledForMs: Math.max(0, Date.now() - recoveryAt),
          timeoutDeadlineAt: turnDeadlineAt,
          ...getActorLogPayload(activeSeat),
        },
      };

      void commitCoordinatorMoveTimeoutRecovery(roomId, action).then((result) => {
        if (cancelled || result.status === 'committed' || result.status === 'duplicate') return;
        inFlightLeaseKeyRef.current = '';
        retryTimer = window.setTimeout(() => setRetryVersion((current) => current + 1), RECOVERY_RETRY_DELAY_MS);
      }).catch(() => {
        if (cancelled) return;
        inFlightLeaseKeyRef.current = '';
        retryTimer = window.setTimeout(() => setRetryVersion((current) => current + 1), RECOVERY_RETRY_DELAY_MS);
      });
    }, Math.max(0, recoveryAt - Date.now()));

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      if (retryTimer !== null) window.clearTimeout(retryTimer);
    };
  }, [
    activeSeat,
    coordinatorEpoch,
    localSeatId,
    movingPieceId,
    onlineGameCoordinatorSeatId,
    pendingTrapPlacement,
    pieces,
    playMode,
    retryVersion,
    roll,
    rollAnimationActive,
    rollResultHolding,
    rollStack,
    rollStackClosed,
    selectedPieceId,
    selectedRollStackIndex,
    seats,
    spectators,
    stackedRollMode,
    turnDeadlineAt,
    turnDeadlineKind,
    turnOrderBlocked,
    winner,
  ]);
}
