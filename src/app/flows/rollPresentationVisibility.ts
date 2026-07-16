export type RollPresentationState = {
  active: boolean;
  actorId: string;
  fallCount: number;
  sourceAnimationId: number | null;
  resultVisible: boolean;
};

type RollPresentationAnimation = {
  id: number;
  phase?: string;
  result?: unknown;
};

export const EMPTY_ROLL_PRESENTATION_STATE: RollPresentationState = {
  active: false,
  actorId: '',
  fallCount: 0,
  sourceAnimationId: null,
  resultVisible: false,
};

let hasTrackedActiveFallPresentation = false;
let trackedActiveFallPresentationActorId = '';

export function isActiveFallPresentationActor(actorId: string) {
  const normalizedActorId = actorId.trim();
  return Boolean(
    hasTrackedActiveFallPresentation
    && normalizedActorId
    && (!trackedActiveFallPresentationActorId || trackedActiveFallPresentationActorId === normalizedActorId),
  );
}

export function isRollPresentationResultVisible(
  animation: RollPresentationAnimation | null,
  settledAnimationId: number | null,
) {
  if (!animation || !('result' in animation)) return false;
  if (animation.phase === 'landing') return false;
  return settledAnimationId === animation.id;
}

const completedRollPresentationIds = new Set<number>();

const rememberRollPresentationLifecycle = (presentation: RollPresentationState) => {
  hasTrackedActiveFallPresentation = presentation.active && presentation.fallCount > 0;
  trackedActiveFallPresentationActorId = hasTrackedActiveFallPresentation ? presentation.actorId.trim() : '';
  const sourceAnimationId = presentation.sourceAnimationId;
  if (!presentation.active || sourceAnimationId === null) return;
  if (presentation.resultVisible) completedRollPresentationIds.add(sourceAnimationId);
  else completedRollPresentationIds.delete(sourceAnimationId);
  if (completedRollPresentationIds.size > 120) {
    const retainedIds = Array.from(completedRollPresentationIds).slice(-60);
    completedRollPresentationIds.clear();
    retainedIds.forEach((animationId) => completedRollPresentationIds.add(animationId));
  }
};

type RollDerivedContentDeferralInput = {
  rollAnimationId: number | null;
  presentation: RollPresentationState;
};

export function shouldDeferRollDerivedContent({
  rollAnimationId,
  presentation,
}: RollDerivedContentDeferralInput) {
  rememberRollPresentationLifecycle(presentation);
  if (rollAnimationId !== null) {
    if (!presentation.active && completedRollPresentationIds.has(rollAnimationId)) return false;
    return presentation.sourceAnimationId !== rollAnimationId || !presentation.resultVisible;
  }
  if (!presentation.active) completedRollPresentationIds.clear();
  return presentation.active && !presentation.resultVisible;
}
