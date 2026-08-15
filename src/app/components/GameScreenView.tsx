import { useEffect, useRef, useState, type ComponentProps } from 'react';
import { STORAGE_KEYS } from '../appState';
import { MoveSubmissionPresentationContext } from '../flows/moveSubmissionPresentationContext';
import {
  beginMoveSubmissionPresentation,
  getOrCreateAutoMoveOpportunity,
  reconcileMoveSubmissionPresentation,
  shouldAttemptAutoMove,
  type AutoMoveOpportunity,
  type MoveSubmissionPresentationState,
} from '../flows/moveSubmissionOpportunityPolicy';
import { GameScreenView as GameScreenViewCore } from './GameScreenViewCore';

type GameScreenViewProps = ComponentProps<typeof GameScreenViewCore>;

const AUTO_SINGLE_MOVE_DELAY_MS = 500;

function getMoveOpportunityKey(props: GameScreenViewProps) {
  const roomId = window.localStorage.getItem(STORAGE_KEYS.activeRoomId) ?? '';
  if (!roomId || !props.activeSeat || !props.roll || props.turnDeadlineKind !== 'move' || props.turnDeadlineAt <= 0) return '';
  return [
    roomId,
    props.activeSeat.id,
    props.turnDeadlineAt,
    `${props.roll.name}:${props.roll.steps}`,
    props.selectedRollStackIndex ?? 'single',
  ].join(':');
}

export function GameScreenView(props: GameScreenViewProps) {
  const moveOpportunityKey = getMoveOpportunityKey(props);
  const autoMoveOpportunityRef = useRef<AutoMoveOpportunity | null>(null);
  const [pendingMovePresentation, setPendingMovePresentation] = useState<MoveSubmissionPresentationState | null>(null);

  const markMoveSubmissionAccepted = (submitted: boolean) => {
    if (!submitted || !moveOpportunityKey) return submitted;
    setPendingMovePresentation(beginMoveSubmissionPresentation(moveOpportunityKey));
    const autoOpportunity = autoMoveOpportunityRef.current;
    if (autoOpportunity?.key === moveOpportunityKey) autoOpportunity.submitted = true;
    return true;
  };

  const handleMoveSelectedPiece: GameScreenViewProps['onMoveSelectedPiece'] = (options) => (
    markMoveSubmissionAccepted(props.onMoveSelectedPiece(options))
  );
  const handleMoveRollStackIndex: GameScreenViewProps['onMoveRollStackIndex'] = (index, options) => (
    markMoveSubmissionAccepted(props.onMoveRollStackIndex(index, options))
  );

  useEffect(() => {
    if (!props.movingPieceId || !moveOpportunityKey) return;
    setPendingMovePresentation((current) => current ?? beginMoveSubmissionPresentation(moveOpportunityKey));
    const autoOpportunity = autoMoveOpportunityRef.current;
    if (autoOpportunity?.key === moveOpportunityKey) autoOpportunity.submitted = true;
  }, [moveOpportunityKey, props.movingPieceId]);

  useEffect(() => {
    setPendingMovePresentation((current) => reconcileMoveSubmissionPresentation(current, {
      currentKey: moveOpportunityKey,
      isMyTurn: props.isMyTurn,
      moveRequestReady: props.moveRequestReady,
      movingPieceActive: Boolean(props.movingPieceId),
    }));
  }, [moveOpportunityKey, props.isMyTurn, props.moveRequestReady, props.movingPieceId]);

  useEffect(() => {
    if (!moveOpportunityKey
      || !props.activeSeat
      || !props.isMyTurn
      || !props.roll
      || props.movingPieceId
      || props.rollResultHolding
      || props.pendingTrapPlacement
      || props.winner
      || props.activeTurnOrderIntro
      || props.turnOrderPhase.active
      || props.waitingForOnlineTurnOrder) return undefined;

    const controlledPieces = props.pieces
      .filter((piece) => props.canSeatControlPiece(props.activeSeat, piece) && !piece.finished);
    if (controlledPieces.length === 0 || controlledPieces.some((piece) => piece.started)) return undefined;

    const lowestLabelPiece = [...controlledPieces]
      .sort((left, right) => left.label.localeCompare(right.label, undefined, { numeric: true }))[0];
    if (!lowestLabelPiece || props.selectedPieceId !== lowestLabelPiece.id) return undefined;

    const now = Date.now();
    const opportunity = getOrCreateAutoMoveOpportunity(
      autoMoveOpportunityRef.current,
      moveOpportunityKey,
      now,
      AUTO_SINGLE_MOVE_DELAY_MS,
    );
    autoMoveOpportunityRef.current = opportunity;
    if (!opportunity) return undefined;

    const submissionPending = pendingMovePresentation?.key === moveOpportunityKey;
    if (submissionPending || opportunity.submitted) {
      opportunity.submitted = true;
      return undefined;
    }
    if (!props.moveRequestReady || !props.moveActionReady) return undefined;

    const attemptSubmission = () => {
      const current = autoMoveOpportunityRef.current;
      if (!shouldAttemptAutoMove({
        opportunity: current,
        key: moveOpportunityKey,
        now: Date.now(),
        moveRequestReady: props.moveRequestReady,
        moveActionReady: props.moveActionReady,
        submissionPending: pendingMovePresentation?.key === moveOpportunityKey,
      })) return;
      if (props.onMoveSelectedPiece()) {
        if (current) current.submitted = true;
        setPendingMovePresentation(beginMoveSubmissionPresentation(moveOpportunityKey));
      }
    };

    const remainingDelayMs = opportunity.readyAt - now;
    if (remainingDelayMs <= 0) {
      attemptSubmission();
      return undefined;
    }
    const timer = window.setTimeout(attemptSubmission, remainingDelayMs);
    return () => window.clearTimeout(timer);
  }, [
    moveOpportunityKey,
    pendingMovePresentation,
    props.activeSeat,
    props.activeTurnOrderIntro,
    props.canSeatControlPiece,
    props.isMyTurn,
    props.moveActionReady,
    props.moveRequestReady,
    props.movingPieceId,
    props.onMoveSelectedPiece,
    props.pendingTrapPlacement,
    props.pieces,
    props.roll,
    props.rollResultHolding,
    props.selectedPieceId,
    props.turnOrderPhase.active,
    props.waitingForOnlineTurnOrder,
    props.winner,
  ]);

  const moveSubmissionPresentationPending = pendingMovePresentation?.key === moveOpportunityKey;

  return (
    <MoveSubmissionPresentationContext.Provider value={moveSubmissionPresentationPending}>
      <GameScreenViewCore
        {...props}
        onMoveSelectedPiece={handleMoveSelectedPiece}
        onMoveRollStackIndex={handleMoveRollStackIndex}
      />
    </MoveSubmissionPresentationContext.Provider>
  );
}
