import type { RollAnimation } from '../appState';
import { isTerminalLiveRollPhase } from './yutRollAnimation';

export type RollPresentationSessionPhase =
  | 'live'
  | 'waiting-authoritative-result'
  | 'resolved'
  | 'result-hold'
  | 'completed'
  | 'cancelled';

export type RollPresentationSession = {
  sourceAnimationId: number;
  phase: RollPresentationSessionPhase;
  latestAnimation: RollAnimation;
  liveCompleted: boolean;
};

export type RollPresentationSessionDecision = {
  kind: 'live' | 'wait' | 'complete-live' | 'resolve' | 'clear';
  session: RollPresentationSession | null;
  preserveDisplayedAnimation: boolean;
};

const isResolvedRollAnimation = (animation: RollAnimation) => (
  animation.phase === undefined || animation.phase === 'resolved'
);

export function applyRollPresentationInput(
  currentSession: RollPresentationSession | null,
  input: RollAnimation | null,
): RollPresentationSessionDecision {
  if (input) {
    const sameSession = currentSession?.sourceAnimationId === input.id;
    const baseSession: RollPresentationSession = sameSession
      ? { ...currentSession, latestAnimation: input }
      : {
        sourceAnimationId: input.id,
        phase: 'live',
        latestAnimation: input,
        liveCompleted: false,
      };

    if (isResolvedRollAnimation(input)) {
      return {
        kind: 'resolve',
        session: {
          ...baseSession,
          phase: 'resolved',
          liveCompleted: false,
        },
        preserveDisplayedAnimation: true,
      };
    }

    return {
      kind: 'live',
      session: {
        ...baseSession,
        phase: 'live',
        liveCompleted: false,
      },
      preserveDisplayedAnimation: true,
    };
  }

  if (!currentSession || currentSession.phase === 'completed' || currentSession.phase === 'cancelled') {
    return { kind: 'clear', session: currentSession, preserveDisplayedAnimation: false };
  }

  if (currentSession.phase === 'live') {
    if (isTerminalLiveRollPhase(currentSession.latestAnimation.phase)) {
      return {
        kind: 'complete-live',
        session: {
          ...currentSession,
          phase: 'result-hold',
          liveCompleted: true,
        },
        preserveDisplayedAnimation: true,
      };
    }

    return {
      kind: 'wait',
      session: {
        ...currentSession,
        phase: 'waiting-authoritative-result',
      },
      preserveDisplayedAnimation: true,
    };
  }

  return {
    kind: 'wait',
    session: currentSession,
    preserveDisplayedAnimation: true,
  };
}

export const markRollPresentationResultHold = (
  session: RollPresentationSession,
): RollPresentationSession => ({
  ...session,
  phase: 'result-hold',
});

export const markRollPresentationCompleted = (
  session: RollPresentationSession,
): RollPresentationSession => ({
  ...session,
  phase: 'completed',
});

export const markRollPresentationCancelled = (
  session: RollPresentationSession,
): RollPresentationSession => ({
  ...session,
  phase: 'cancelled',
});

export const shouldPreserveRollPresentation = (
  session: RollPresentationSession | null | undefined,
) => Boolean(session && session.phase !== 'completed' && session.phase !== 'cancelled');
