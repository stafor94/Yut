import {
  normalizeTurnDeadlineAt,
  normalizeTurnDeadlineKind,
  type TurnDeadlineKind,
} from '../../features/room/services/turnDeadlinePolicy';

export type MoveActionReadinessInput = {
  canSubmitTurnAction: boolean;
  rollPresentationBlocked: boolean;
  hasPendingMoveAction: boolean;
  hasValidMoveSelection: boolean;
  rollResultHolding: boolean;
  rollAnimationActive: boolean;
  moveInProgress: boolean;
  movingPieceActive: boolean;
  isOnlineMode: boolean;
  turnDeadlineAt: unknown;
  turnDeadlineKind: unknown;
};

export type MoveActionReadiness = {
  actionReady: boolean;
  timerReady: boolean;
  hasAuthoritativeMoveDeadline: boolean;
  authoritativeDeadlineAt: number;
  authoritativeDeadlineKind: TurnDeadlineKind;
};

export type MoveActionSubmissionOptions = {
  deadlineAutoSubmitted?: boolean;
  autoSubmittedDeadlineAt?: number;
  clientActionStartedAt?: number;
  rollStackIndex?: number;
};

export function getMoveActionReadiness({
  canSubmitTurnAction,
  rollPresentationBlocked,
  hasPendingMoveAction,
  hasValidMoveSelection,
  rollResultHolding,
  rollAnimationActive,
  moveInProgress,
  movingPieceActive,
  isOnlineMode,
  turnDeadlineAt,
  turnDeadlineKind,
}: MoveActionReadinessInput): MoveActionReadiness {
  const authoritativeDeadlineAt = normalizeTurnDeadlineAt(turnDeadlineAt);
  const authoritativeDeadlineKind = normalizeTurnDeadlineKind(turnDeadlineKind);
  const hasAuthoritativeMoveDeadline = Boolean(
    authoritativeDeadlineKind === 'move' && authoritativeDeadlineAt > 0
  );
  const baseActionReady = Boolean(
    canSubmitTurnAction
    && !rollPresentationBlocked
    && !hasPendingMoveAction
    && hasValidMoveSelection
    && !rollResultHolding
    && !rollAnimationActive
    && !moveInProgress
    && !movingPieceActive
  );
  const actionReady = Boolean(
    baseActionReady
    && (!isOnlineMode || hasAuthoritativeMoveDeadline)
  );

  return {
    actionReady,
    timerReady: Boolean(isOnlineMode && actionReady && hasAuthoritativeMoveDeadline),
    hasAuthoritativeMoveDeadline,
    authoritativeDeadlineAt: hasAuthoritativeMoveDeadline ? authoritativeDeadlineAt : 0,
    authoritativeDeadlineKind,
  };
}

export function getMoveActionReady(input: MoveActionReadinessInput) {
  return getMoveActionReadiness(input).actionReady;
}
