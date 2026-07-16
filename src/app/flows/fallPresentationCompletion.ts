export type PendingFallPresentationCompletion = {
  actorId: string;
  sourceAnimationId: number | null;
  authoritativeEffectId: number | null;
};

type FallPresentationEffectIdentity = {
  id: number;
  seatId: string;
};

export const createPendingFallPresentationCompletion = ({
  presentationActorId,
  sourceAnimationId,
  fallEffect,
}: {
  presentationActorId: string;
  sourceAnimationId: number | null;
  fallEffect: FallPresentationEffectIdentity | null;
}): PendingFallPresentationCompletion => ({
  actorId: fallEffect?.seatId || presentationActorId,
  sourceAnimationId,
  authoritativeEffectId: fallEffect?.id ?? null,
});

export const bindPendingFallPresentationEffect = (
  pending: PendingFallPresentationCompletion,
  fallEffect: FallPresentationEffectIdentity,
): PendingFallPresentationCompletion => ({
  ...pending,
  actorId: fallEffect.seatId,
  authoritativeEffectId: fallEffect.id,
});

export const shouldClearPendingFallPresentation = (
  pending: PendingFallPresentationCompletion,
  fallEffect: FallPresentationEffectIdentity | null,
) => !fallEffect && pending.authoritativeEffectId !== null;
