import { useEffect, useRef, useSyncExternalStore } from 'react';
import type { BoardPiece } from '../../features/game/components/GameBoard';
import type { YutResult } from '../../game-core/roll';
import { STORAGE_KEYS, type Seat } from '../appState';
import {
  canExecuteScheduledMoveNow,
  getLatestMoveExecutionContextKey,
  getMoveTransitionReadinessSnapshot,
  subscribeMoveTransitionReadiness,
} from '../flows/moveExecutionPolicy';
import type { MoveActionSubmissionOptions } from '../flows/moveActionReadiness';
import {
  getOrCreateAutoMoveOpportunity,
  markAutoMoveSubmitted,
  shouldAttemptAutoMove,
  type AutoMoveOpportunity,
} from '../flows/moveSubmissionOpportunityPolicy';

type DurableStartPieceAutoMoveInput = {
  activeSeat: Seat | undefined;
  activeTurnOrderIntro: unknown;
  canSeatControlPiece: (seat: Seat | undefined, piece: BoardPiece | undefined) => boolean;
  isMyTurn: boolean;
  moveActionReady: boolean;
  moveRequestReady: boolean;
  movingPieceId: string;
  onMoveSelectedPiece: (options?: MoveActionSubmissionOptions) => boolean;
  onSelectPieceId: (pieceId: string) => void;
  pendingTrapPlacement: boolean;
  pieces: BoardPiece[];
  roll: YutResult | null;
  rollResultHolding: boolean;
  selectedPieceId: string;
  selectedRollStackIndex: number | null;
  turnDeadlineAt: number;
  turnDeadlineKind: 'roll' | 'move' | 'item_prompt' | 'trap_placement' | '';
  turnOrderActive: boolean;
  waitingForOnlineTurnOrder: boolean;
  winner: string;
};

function getMoveOpportunityKey({
  activeSeat,
  roll,
  selectedRollStackIndex,
  turnDeadlineAt,
  turnDeadlineKind,
}: Pick<DurableStartPieceAutoMoveInput, 'activeSeat' | 'roll' | 'selectedRollStackIndex' | 'turnDeadlineAt' | 'turnDeadlineKind'>, pieceId: string) {
  const roomId = window.localStorage.getItem(STORAGE_KEYS.activeRoomId) ?? '';
  if (!roomId || !activeSeat || !roll || !pieceId || turnDeadlineKind !== 'move' || turnDeadlineAt <= 0) return '';
  return [
    roomId,
    activeSeat.id,
    turnDeadlineAt,
    `${roll.name}:${roll.steps}`,
    selectedRollStackIndex ?? 'single',
    pieceId,
  ].join(':');
}

function isCurrentMoveTransitionReady({
  activeSeatId,
  turnDeadlineAt,
  transitionActionReady,
  transitionContextKey,
}: {
  activeSeatId: string;
  turnDeadlineAt: number;
  transitionActionReady: boolean;
  transitionContextKey: string;
}) {
  return Boolean(
    transitionActionReady
    && activeSeatId
    && transitionContextKey.startsWith(`${activeSeatId}:move:`)
    && transitionContextKey.endsWith(`:move:${turnDeadlineAt}`),
  );
}

export function useDurableStartPieceAutoMove({
  activeSeat,
  activeTurnOrderIntro,
  canSeatControlPiece,
  isMyTurn,
  moveActionReady,
  moveRequestReady,
  movingPieceId,
  onMoveSelectedPiece,
  onSelectPieceId,
  pendingTrapPlacement,
  pieces,
  roll,
  rollResultHolding,
  selectedPieceId,
  selectedRollStackIndex,
  turnDeadlineAt,
  turnDeadlineKind,
  turnOrderActive,
  waitingForOnlineTurnOrder,
  winner,
}: DurableStartPieceAutoMoveInput) {
  const opportunityRef = useRef<AutoMoveOpportunity | null>(null);
  const moveTransitionReadiness = useSyncExternalStore(
    subscribeMoveTransitionReadiness,
    getMoveTransitionReadinessSnapshot,
    getMoveTransitionReadinessSnapshot,
  );
  const transitionReadyForCurrentMove = isCurrentMoveTransitionReady({
    activeSeatId: activeSeat?.id ?? '',
    turnDeadlineAt,
    transitionActionReady: moveTransitionReadiness.actionReady,
    transitionContextKey: moveTransitionReadiness.contextKey,
  });
  const canonicalMoveReady = moveRequestReady && moveActionReady && transitionReadyForCurrentMove;

  useEffect(() => {
    if (!activeSeat || !isMyTurn || !roll || turnDeadlineKind !== 'move' || turnDeadlineAt <= 0) {
      opportunityRef.current = null;
      return undefined;
    }
    if (movingPieceId
      || rollResultHolding
      || pendingTrapPlacement
      || winner
      || activeTurnOrderIntro
      || turnOrderActive
      || waitingForOnlineTurnOrder) return undefined;

    const controlledPieces = pieces.filter((piece) => canSeatControlPiece(activeSeat, piece) && !piece.finished);
    if (controlledPieces.length === 0 || controlledPieces.some((piece) => piece.started)) return undefined;

    const lowestLabelPiece = [...controlledPieces]
      .sort((left, right) => left.label.localeCompare(right.label, undefined, { numeric: true }))[0];
    if (!lowestLabelPiece) return undefined;

    const opportunityKey = getMoveOpportunityKey({
      activeSeat,
      roll,
      selectedRollStackIndex,
      turnDeadlineAt,
      turnDeadlineKind,
    }, lowestLabelPiece.id);
    if (!opportunityKey) {
      opportunityRef.current = null;
      return undefined;
    }

    if (selectedPieceId !== lowestLabelPiece.id) {
      onSelectPieceId(lowestLabelPiece.id);
      return undefined;
    }

    const now = Date.now();
    const opportunity = getOrCreateAutoMoveOpportunity(
      opportunityRef.current,
      opportunityKey,
      now,
      canonicalMoveReady,
    );
    opportunityRef.current = opportunity;
    if (!opportunity || opportunity.submitted) return undefined;

    const attemptSubmission = () => {
      const current = opportunityRef.current;
      const currentTransition = getMoveTransitionReadinessSnapshot();
      const transitionActionReady = isCurrentMoveTransitionReady({
        activeSeatId: activeSeat.id,
        turnDeadlineAt,
        transitionActionReady: currentTransition.actionReady,
        transitionContextKey: currentTransition.contextKey,
      });
      const executionContextKey = getLatestMoveExecutionContextKey();
      if (!shouldAttemptAutoMove({
        opportunity: current,
        key: opportunityKey,
        now: Date.now(),
        moveRequestReady,
        moveActionReady,
        transitionActionReady,
        submissionPending: Boolean(movingPieceId),
      }) || !canExecuteScheduledMoveNow(executionContextKey)) return;
      if (onMoveSelectedPiece()) markAutoMoveSubmitted(current, opportunityKey);
    };

    let readyFrameId = 0;
    let submitFrameId = 0;
    let readyTimerId = 0;
    const scheduleAfterPresentedReadyFrame = () => {
      readyFrameId = window.requestAnimationFrame(() => {
        submitFrameId = window.requestAnimationFrame(attemptSubmission);
      });
    };

    const remainingDelayMs = opportunity.readyAt - now;
    if (remainingDelayMs <= 0) {
      scheduleAfterPresentedReadyFrame();
    } else {
      readyTimerId = window.setTimeout(scheduleAfterPresentedReadyFrame, remainingDelayMs);
    }
    return () => {
      if (readyTimerId) window.clearTimeout(readyTimerId);
      if (readyFrameId) window.cancelAnimationFrame(readyFrameId);
      if (submitFrameId) window.cancelAnimationFrame(submitFrameId);
    };
  }, [
    activeSeat,
    activeTurnOrderIntro,
    canSeatControlPiece,
    canonicalMoveReady,
    isMyTurn,
    moveActionReady,
    moveRequestReady,
    movingPieceId,
    onMoveSelectedPiece,
    onSelectPieceId,
    pendingTrapPlacement,
    pieces,
    roll,
    rollResultHolding,
    selectedPieceId,
    selectedRollStackIndex,
    turnDeadlineAt,
    turnDeadlineKind,
    turnOrderActive,
    waitingForOnlineTurnOrder,
    winner,
  ]);
}
