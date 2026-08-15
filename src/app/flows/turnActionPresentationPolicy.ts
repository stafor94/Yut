import { getMoveSubmissionPendingSnapshot } from './moveSubmissionPresentationState';

export type TurnActionPresentationPhase = 'roll' | 'move';

export const isTurnActionPresentationPending = ({
  phase,
  hasRoll,
  canRollNow,
  canSubmitTurnAction,
  rollResultHolding,
}: {
  phase: TurnActionPresentationPhase;
  hasRoll: boolean;
  canRollNow: boolean;
  canSubmitTurnAction: boolean;
  rollResultHolding: boolean;
}) => Boolean(
  rollResultHolding
  || (phase === 'move' && getMoveSubmissionPendingSnapshot())
  || (phase === 'roll' && !hasRoll && !canRollNow)
);
