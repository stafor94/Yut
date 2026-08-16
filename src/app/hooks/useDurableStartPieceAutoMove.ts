import { useEffect, useRef, useSyncExternalStore } from 'react';
import type { BoardPiece } from '../../features/game/components/GameBoard';
import { BRANCH_NODE_IDS } from '../../game-core/board/board';
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
  isManualStackMoveSelectionCurrent,
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

function getDeterministicAutoMovePiece({
  activeSeat,
  canSeatControlPiece,
  pieces,
  roll,
}: {
  activeSeat: Seat;
  canSeatControlPiece: DurableStartPieceAutoMoveInput['canSeatControlPiece'];
  pieces: BoardPiece[];
  roll: YutResult;
}) {
  const movablePieces = pieces.filter((piece) => (
    canSeatControlPiece(activeSeat, piece)
    && !piece.finished
    && (roll.steps >= 0 || piece.started)
  ));
  if (movablePieces.length === 0) return undefined;

  const hasPieceOnBoard = pieces.some((piece) => (
    canSeatControlPiece(activeSeat, piece)
    && piece.started
    && !piece.finished
  ));
  const autoMovePiece = !hasPieceOnBoard
    ? [...movablePieces].sort((left, right) => left.label.localeCompare(right.label, undefined, { numeric: true }))[0]
    : (() => {
        const movableGroups = Array.from(new Map(
          movablePieces.map((piece) => [piece.started ? piece.nodeId : piece.id, piece]),
        ).values());
        return movableGroups.length === 1 ? movableGroups[0] : undefined;
      })();
  if (!autoMovePiece) return undefined;

  const needsBranchChoice = roll.steps > 0
    && autoMovePiece.started
    && BRANCH_NODE_IDS.includes(autoMovePiece.nodeId as typeof BRANCH_NODE_IDS[number]);
  return needsBranchChoice ? undefined : autoMovePiece;
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

    const autoMovePiece = getDeterministicAutoMovePiece({
      activeSeat,
      canSeatControlPiece,
      pieces,
      roll,
    });
    if (!autoMovePiece) return undefined;

    const opportunityKey = getMoveOpportunityKey({
      activeSeat,
      roll,
      selectedRollStackIndex,
      turnDeadlineAt,
      turnDeadlineKind,
    }, autoMovePiece.id);
    if (!opportunityKey) {
      opportunityRef.current = null;
      return undefined;
    }

    if (selectedPieceId !== autoMovePiece.id) {
      onSelectPieceId(autoMovePiece.id);
      return undefined;
    }

    if (isManualStackMoveSelectionCurrent({
      activeSeatId: activeSeat.id,
      turnDeadlineAt,
      rollStackIndex: selectedRollStackIndex,
      roll,
    })) {
      opportunityRef.current = null;
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
