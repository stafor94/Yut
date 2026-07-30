import {
  getRollFallCountForTimingZone,
  isRollTimingZone,
  normalizeRollFallCount,
  shouldFallForTimingZone,
  type RollTimingZone,
} from '../../../game-core/roll';

type RollTimingActionLike = {
  type: string;
  payload?: Record<string, unknown>;
};

const getSubmittedTimingZone = (payload: Record<string, unknown>): RollTimingZone => (
  isRollTimingZone(payload.rollTimingZone) ? payload.rollTimingZone : 'bad'
);

/**
 * Normalize roll inputs before the authoritative reducer runs.
 * Older Normal clients keep their previous 1~4 fall-count contract while the
 * reducer continues to evaluate Normal as Bad for the existing probability rule.
 */
export const normalizeLegacyRollTimingAction = <TAction extends RollTimingActionLike>(action: TAction): TAction => {
  if (action.type !== 'roll_yut') return action;
  const payload = action.payload ?? {};
  if (payload.completeFallPresentation === true) return action;

  const submittedTimingZone = getSubmittedTimingZone(payload);
  const reducerTimingZone = submittedTimingZone === 'normal' ? 'bad' : submittedTimingZone;
  const selectedGoldenYutResult = payload.selectedGoldenYutResult;
  const submittedFallOccurred = payload.clientFallOccurred;
  const fallOccurred = selectedGoldenYutResult
    ? false
    : typeof submittedFallOccurred === 'boolean'
      ? submittedFallOccurred
      : shouldFallForTimingZone(reducerTimingZone);
  const submittedFallCount = payload.clientFallCount;
  const fallCount = fallOccurred
    ? submittedFallCount === undefined
      ? getRollFallCountForTimingZone(submittedTimingZone)
      : normalizeRollFallCount(submittedTimingZone, submittedFallCount)
    : 0;

  return {
    ...action,
    payload: {
      ...payload,
      rollTimingZone: reducerTimingZone,
      clientFallOccurred: fallOccurred,
      clientFallCount: fallCount,
      ...(submittedTimingZone === 'normal' ? { legacyRollTimingZone: 'normal' } : {}),
    },
  } as TAction;
};
