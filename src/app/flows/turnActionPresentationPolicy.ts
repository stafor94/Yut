export type TurnActionPresentationPhase = 'roll' | 'move';

export const isTurnActionPresentationPending = ({
  phase,
  hasRoll,
  canSubmitTurnAction,
  rollResultHolding,
}: {
  phase: TurnActionPresentationPhase;
  hasRoll: boolean;
  canSubmitTurnAction: boolean;
  rollResultHolding: boolean;
}) => Boolean(
  rollResultHolding
  || (phase === 'roll' && !hasRoll && !canSubmitTurnAction)
);
