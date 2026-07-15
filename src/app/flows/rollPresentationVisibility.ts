import type { RollAnimation } from '../appState';

export type RollPresentationState = {
  active: boolean;
  actorId: string;
  fallCount: number;
  sourceAnimationId: number | null;
  resultVisible: boolean;
};

export const EMPTY_ROLL_PRESENTATION_STATE: RollPresentationState = {
  active: false,
  actorId: '',
  fallCount: 0,
  sourceAnimationId: null,
  resultVisible: false,
};

export function isRollPresentationResultVisible(
  animation: RollAnimation | null,
  settledAnimationId: number | null,
) {
  if (!animation || !('result' in animation)) return false;
  if (animation.phase === 'landing') return false;
  return settledAnimationId === animation.id;
}

type RollDerivedContentDeferralInput = {
  rollAnimationId: number | null;
  presentation: RollPresentationState;
};

export function shouldDeferRollDerivedContent({
  rollAnimationId,
  presentation,
}: RollDerivedContentDeferralInput) {
  if (rollAnimationId !== null) {
    return presentation.sourceAnimationId !== rollAnimationId || !presentation.resultVisible;
  }
  return presentation.active && !presentation.resultVisible;
}
