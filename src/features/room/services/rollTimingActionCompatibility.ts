type RollTimingActionLike = {
  type: string;
  payload?: Record<string, unknown>;
};

/** Older clients may still submit the removed Normal grade. Treat it as Bad at the online commit boundary. */
export const normalizeLegacyRollTimingAction = <TAction extends RollTimingActionLike>(action: TAction): TAction => (
  action.type === 'roll_yut' && action.payload?.rollTimingZone === 'normal'
    ? { ...action, payload: { ...action.payload, rollTimingZone: 'bad' } } as TAction
    : action
);
