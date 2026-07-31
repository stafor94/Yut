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
  || (phase === 'roll' && !hasRoll && (!canRollNow || !canSubmitTurnAction))
);
