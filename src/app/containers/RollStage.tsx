import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { gamePresentationLock } from '../../shared/gamePresentationLock';
import { YutRollScenePhysics } from '../components/YutRollScenePhysics';
import {
  createGameAnimationSequence,
  gameAnimationQueue,
  getRollPresentationAnimationId,
  type GameAnimationSequence,
} from '../flows/gameAnimationQueue';
import {
  notifyFallPresentationActive,
  notifyRollPresentationCompleted,
} from '../flows/rollPresentationEvents';
import {
  createRollPresentationCompletion,
  type RollPresentationCompletion,
  type RollPresentationSettleSource,
  type RollPresentationVisualResult,
} from '../flows/rollPresentationCompletion';
import {
  applyRollPresentationInput,
  markRollPresentationCancelled,
  markRollPresentationCompleted,
  markRollPresentationResultHold,
  shouldPreserveRollPresentation,
  type RollPresentationSession,
} from '../flows/rollPresentationSession';
import {
  EMPTY_ROLL_PRESENTATION_STATE,
  isRollPresentationResultVisible,
  type RollPresentationState,
} from '../flows/rollPresentationVisibility';
import type { RollAnimation } from '../appState';

type RollStageProps = {
  rollAnimation: RollAnimation | null;
  presentationActorId?: string;
  onPresentationChange?: (state: RollPresentationState) => void;
};

type PresentationTimingGrade = 'perfect' | 'nice' | 'good' | 'bad';

const TIMING_GRADE_LABELS: Record<PresentationTimingGrade, string> = {
  perfect: 'Perfect!',
  nice: 'Nice!',
  good: 'Good!',
  bad: 'Bad!',
};

const normalizePresentationTimingGrade = (value: unknown): PresentationTimingGrade | undefined => {
  if (value === 'normal') return 'bad';
  if (value === 'perfect' || value === 'nice' || value === 'good' || value === 'bad') return value;
  return undefined;
};

const getPresentationTimingGrade = (animation: RollAnimation): PresentationTimingGrade | undefined => {
  const directGrade = normalizePresentationTimingGrade(animation.timingZone);
  if (directGrade) return directGrade;
  if (!('result' in animation) || !animation.result || typeof animation.result !== 'object') return undefined;
  return normalizePresentationTimingGrade((animation.result as unknown as Record<string, unknown>).presentationTimingGrade);
};

const isResolvedRollAnimation = (animation: RollAnimation) => animation.phase === undefined || animation.phase === 'resolved';

type PresentationSettleSource = 'pending' | Exclude<RollPresentationVisualResult, 'cancelled'>;

export function RollStage({ rollAnimation, presentationActorId = '', onPresentationChange }: RollStageProps) {
  const mountedRef = useRef(true);
  const rollStageRef = useRef<HTMLDivElement | null>(null);
  const presentedAnimationRef = useRef<RollAnimation | null>(rollAnimation);
  const presentedSourceAnimationIdRef = useRef<number | null>(rollAnimation?.id ?? null);
  const liveAnimationByIdRef = useRef<Map<number, RollAnimation>>(new Map());
  const rollSequenceByIdRef = useRef<Map<number, GameAnimationSequence<RollAnimation>>>(new Map());
  const presentationSessionByIdRef = useRef<Map<number, RollPresentationSession>>(new Map());
  const activeRollSequenceIdRef = useRef<number | null>(null);
  const currentInputSessionIdRef = useRef<number | null>(rollAnimation?.id ?? null);
  const seenResolvedAnimationIdsRef = useRef<Set<number>>(new Set());
  const queuedPresentationMetaRef = useRef<Map<number, { actorId: string; fallCount: number }>>(new Map());
  const presentationCompletionByIdRef = useRef<Map<number, RollPresentationCompletion>>(new Map());
  const onPresentationChangeRef = useRef(onPresentationChange);
  const presentationReleaseRef = useRef<(() => void) | null>(null);
  const hadPresentedAnimationRef = useRef(Boolean(rollAnimation));
  const [presentedAnimation, setPresentedAnimation] = useState<RollAnimation | null>(rollAnimation);
  const [settledAnimationId, setSettledAnimationId] = useState<number | null>(null);
  const [settleSource, setSettleSource] = useState<PresentationSettleSource>('pending');
  onPresentationChangeRef.current = onPresentationChange;

  const emitPresentationChange = (state: RollPresentationState) => {
    onPresentationChangeRef.current?.(state);
    notifyFallPresentationActive(state.active && state.fallCount > 0);
  };

  const presentAnimation = (nextAnimation: RollAnimation | null, sourceAnimationId = nextAnimation?.id ?? null) => {
    presentedAnimationRef.current = nextAnimation;
    presentedSourceAnimationIdRef.current = sourceAnimationId;
    setPresentedAnimation(nextAnimation);
  };

  const updatePresentationSession = (
    sourceAnimationId: number,
    update: (session: RollPresentationSession) => RollPresentationSession,
  ) => {
    const session = presentationSessionByIdRef.current.get(sourceAnimationId);
    if (!session) return;
    presentationSessionByIdRef.current.set(sourceAnimationId, update(session));
  };

  const markCurrentAnimationSettled = (source: RollPresentationSettleSource) => {
    const currentAnimation = presentedAnimationRef.current;
    if (!currentAnimation) return;
    setSettledAnimationId(currentAnimation.id);
    setSettleSource((current) => current === 'pending' ? source : current);
    presentationCompletionByIdRef.current.get(currentAnimation.id)?.markSettled(source);
  };

  const notifyQueuedPresentation = () => {
    const firstEntry = queuedPresentationMetaRef.current.entries().next().value as [number, { actorId: string; fallCount: number }] | undefined;
    if (!firstEntry) {
      emitPresentationChange(EMPTY_ROLL_PRESENTATION_STATE);
      return;
    }
    const [sourceAnimationId, meta] = firstEntry;
    emitPresentationChange({
      active: true,
      actorId: meta.actorId,
      fallCount: meta.fallCount,
      sourceAnimationId,
      resultVisible: false,
    });
  };

  const runResolvedPresentation = async (sourceAnimationId: number, sourceAnimation: RollAnimation) => {
    if (!mountedRef.current) return;
    const queuedAnimation: RollAnimation = {
      ...sourceAnimation,
      id: getRollPresentationAnimationId(sourceAnimation.id),
      sticks: sourceAnimation.sticks.map((stick) => ({ ...stick })),
    };
    const completion = createRollPresentationCompletion();
    presentationCompletionByIdRef.current.set(queuedAnimation.id, completion);
    setSettledAnimationId(null);
    setSettleSource('pending');
    presentAnimation(queuedAnimation, sourceAnimationId);
    try {
      const visualResult = await completion.waitForVisualSettle();
      if (visualResult === 'cancelled') {
        updatePresentationSession(sourceAnimationId, markRollPresentationCancelled);
        return;
      }
      if (!mountedRef.current || presentedAnimationRef.current?.id !== queuedAnimation.id) return;
      setSettleSource(visualResult);
      updatePresentationSession(sourceAnimationId, markRollPresentationResultHold);
      if (visualResult === 'watchdog') {
        console.warn('윷 애니메이션 렌더러 완료 신호가 없어 watchdog으로 결과를 확정합니다.', {
          animationId: queuedAnimation.id,
          sourceAnimationId,
        });
        setSettledAnimationId(queuedAnimation.id);
      }
      const holdResult = await completion.waitForResultHold();
      if (holdResult === 'cancelled') {
        updatePresentationSession(sourceAnimationId, markRollPresentationCancelled);
        return;
      }
    } finally {
      presentationCompletionByIdRef.current.delete(queuedAnimation.id);
    }
    updatePresentationSession(sourceAnimationId, markRollPresentationCompleted);
    if (mountedRef.current && presentedAnimationRef.current?.id === queuedAnimation.id) presentAnimation(null);
  };

  const queueRollSequence = (sourceAnimationId: number) => {
    const existing = rollSequenceByIdRef.current.get(sourceAnimationId);
    if (existing) return existing;

    const sequence = createGameAnimationSequence<RollAnimation>();
    rollSequenceByIdRef.current.set(sourceAnimationId, sequence);
    const releaseQueuedPresentation = gamePresentationLock.acquire();
    void gameAnimationQueue.enqueue(`roll:${sourceAnimationId}`, async () => {
      activeRollSequenceIdRef.current = sourceAnimationId;
      let presentedLive = false;
      if (!sequence.isSettled()) {
        const latestLiveAnimation = liveAnimationByIdRef.current.get(sourceAnimationId);
        if (mountedRef.current && latestLiveAnimation) {
          presentAnimation(latestLiveAnimation, sourceAnimationId);
          presentedLive = true;
        }
      }
      const resolvedAnimation = await sequence.wait();
      if (!resolvedAnimation) {
        updatePresentationSession(sourceAnimationId, markRollPresentationCancelled);
        if (mountedRef.current && presentedSourceAnimationIdRef.current === sourceAnimationId) {
          presentAnimation(null);
        }
        return;
      }
      if (!mountedRef.current) return;
      const session = presentationSessionByIdRef.current.get(sourceAnimationId);
      if (session?.liveCompleted) {
        if (presentedLive || presentedSourceAnimationIdRef.current === sourceAnimationId) {
          updatePresentationSession(sourceAnimationId, markRollPresentationCompleted);
          if (presentedSourceAnimationIdRef.current === sourceAnimationId) presentAnimation(null);
          return;
        }
        if (!('result' in resolvedAnimation)) return;
        await runResolvedPresentation(sourceAnimationId, {
          id: resolvedAnimation.id,
          phase: 'resolved',
          result: resolvedAnimation.result,
          sticks: resolvedAnimation.sticks,
          fallCount: resolvedAnimation.fallCount,
          timingZone: resolvedAnimation.timingZone,
        });
        return;
      }
      await runResolvedPresentation(sourceAnimationId, resolvedAnimation);
    }).finally(() => {
      releaseQueuedPresentation();
      if (activeRollSequenceIdRef.current === sourceAnimationId) activeRollSequenceIdRef.current = null;
      if (currentInputSessionIdRef.current === sourceAnimationId) currentInputSessionIdRef.current = null;
      rollSequenceByIdRef.current.delete(sourceAnimationId);
      liveAnimationByIdRef.current.delete(sourceAnimationId);
      presentationSessionByIdRef.current.delete(sourceAnimationId);
      queuedPresentationMetaRef.current.delete(sourceAnimationId);
      if (mountedRef.current) notifyQueuedPresentation();
    });
    return sequence;
  };

  useLayoutEffect(() => {
    mountedRef.current = true;
    const releaseQueue = gameAnimationQueue.acquire();
    return () => {
      mountedRef.current = false;
      rollSequenceByIdRef.current.forEach((sequence) => sequence.cancel());
      rollSequenceByIdRef.current.clear();
      liveAnimationByIdRef.current.clear();
      presentationSessionByIdRef.current.clear();
      activeRollSequenceIdRef.current = null;
      currentInputSessionIdRef.current = null;
      queuedPresentationMetaRef.current.clear();
      presentationCompletionByIdRef.current.forEach((completion) => completion.cancel());
      presentationCompletionByIdRef.current.clear();
      emitPresentationChange(EMPTY_ROLL_PRESENTATION_STATE);
      presentationReleaseRef.current?.();
      presentationReleaseRef.current = null;
      releaseQueue();
    };
  }, []);

  useLayoutEffect(() => {
    if (presentedAnimation) {
      if (!presentationReleaseRef.current) presentationReleaseRef.current = gamePresentationLock.acquire();
      return;
    }
    presentationReleaseRef.current?.();
    presentationReleaseRef.current = null;
  }, [Boolean(presentedAnimation)]);

  useLayoutEffect(() => {
    const hasPresentedAnimation = Boolean(presentedAnimation);
    if (hadPresentedAnimationRef.current && !hasPresentedAnimation) notifyRollPresentationCompleted();
    hadPresentedAnimationRef.current = hasPresentedAnimation;
  }, [presentedAnimation]);

  useLayoutEffect(() => {
    if (!rollAnimation) {
      const sourceAnimationId = currentInputSessionIdRef.current;
      if (sourceAnimationId !== null) {
        currentInputSessionIdRef.current = null;
        const currentSession = presentationSessionByIdRef.current.get(sourceAnimationId) ?? null;
        const decision = applyRollPresentationInput(currentSession, null);
        if (decision.session) presentationSessionByIdRef.current.set(sourceAnimationId, decision.session);

        if (decision.kind === 'complete-live') {
          const sequence = rollSequenceByIdRef.current.get(sourceAnimationId);
          if (sequence && !sequence.isSettled() && decision.session) {
            sequence.resolve(decision.session.latestAnimation);
          }
          return;
        }

        if (decision.preserveDisplayedAnimation) {
          return;
        }
      }

      const displayedSourceAnimationId = presentedSourceAnimationIdRef.current;
      const displayedSession = displayedSourceAnimationId === null
        ? null
        : presentationSessionByIdRef.current.get(displayedSourceAnimationId);
      if (shouldPreserveRollPresentation(displayedSession)) return;
      const currentAnimation = presentedAnimationRef.current;
      if (currentAnimation && isResolvedRollAnimation(currentAnimation) && queuedPresentationMetaRef.current.size > 0) return;
      presentAnimation(null);
      return;
    }

    const sourceAnimationId = rollAnimation.id;
    if (!isResolvedRollAnimation(rollAnimation)) {
      currentInputSessionIdRef.current = sourceAnimationId;
      const liveAnimation: RollAnimation = {
        ...rollAnimation,
        sticks: rollAnimation.sticks.map((stick) => ({ ...stick })),
      };
      liveAnimationByIdRef.current.set(sourceAnimationId, liveAnimation);
      const decision = applyRollPresentationInput(
        presentationSessionByIdRef.current.get(sourceAnimationId) ?? null,
        liveAnimation,
      );
      if (decision.session) presentationSessionByIdRef.current.set(sourceAnimationId, decision.session);
      const existingMeta = queuedPresentationMetaRef.current.get(sourceAnimationId);
      queuedPresentationMetaRef.current.set(sourceAnimationId, {
        actorId: presentationActorId || existingMeta?.actorId || '',
        fallCount: existingMeta?.fallCount ?? 0,
      });
      notifyQueuedPresentation();
      const sequence = queueRollSequence(sourceAnimationId);
      if (activeRollSequenceIdRef.current === sourceAnimationId && !sequence.isSettled()) {
        presentAnimation(liveAnimation, sourceAnimationId);
      }
      return;
    }

    if (currentInputSessionIdRef.current === sourceAnimationId) currentInputSessionIdRef.current = null;
    const fallCount = 'fallCount' in rollAnimation ? rollAnimation.fallCount ?? 0 : 0;
    const existingMeta = queuedPresentationMetaRef.current.get(sourceAnimationId);
    if (seenResolvedAnimationIdsRef.current.has(sourceAnimationId)) {
      if (existingMeta && presentationActorId && existingMeta.actorId !== presentationActorId) {
        queuedPresentationMetaRef.current.set(sourceAnimationId, {
          actorId: presentationActorId,
          fallCount,
        });
        notifyQueuedPresentation();
      }
      return;
    }
    queuedPresentationMetaRef.current.set(sourceAnimationId, {
      actorId: presentationActorId || existingMeta?.actorId || '',
      fallCount,
    });
    notifyQueuedPresentation();
    seenResolvedAnimationIdsRef.current.add(sourceAnimationId);
    if (seenResolvedAnimationIdsRef.current.size > 120) {
      seenResolvedAnimationIdsRef.current = new Set(Array.from(seenResolvedAnimationIdsRef.current).slice(-60));
    }

    const sourceAnimation: RollAnimation = {
      ...rollAnimation,
      sticks: rollAnimation.sticks.map((stick) => ({ ...stick })),
    };
    const decision = applyRollPresentationInput(
      presentationSessionByIdRef.current.get(sourceAnimationId) ?? null,
      sourceAnimation,
    );
    if (decision.session) presentationSessionByIdRef.current.set(sourceAnimationId, decision.session);
    queueRollSequence(sourceAnimationId).resolve(sourceAnimation);
  }, [presentationActorId, rollAnimation]);

  useLayoutEffect(() => {
    const currentAnimation = presentedAnimationRef.current;
    if (!currentAnimation) {
      if (queuedPresentationMetaRef.current.size === 0) emitPresentationChange(EMPTY_ROLL_PRESENTATION_STATE);
      return;
    }
    const sourceAnimationId = presentedSourceAnimationIdRef.current ?? currentAnimation.id;
    const queuedMeta = queuedPresentationMetaRef.current.get(sourceAnimationId);
    const fallCount = 'fallCount' in currentAnimation ? currentAnimation.fallCount ?? 0 : 0;
    emitPresentationChange({
      active: true,
      actorId: queuedMeta?.actorId || presentationActorId,
      fallCount,
      sourceAnimationId,
      resultVisible: isRollPresentationResultVisible(currentAnimation, settledAnimationId),
    });
  }, [presentedAnimation, presentationActorId, settledAnimationId]);

  if (!presentedAnimation) return null;
  const isPreResult = presentedAnimation.phase === 'primary' || presentedAnimation.phase === 'extra-spin';
  const isLanding = presentedAnimation.phase === 'landing';
  const isResultHold = presentedAnimation.phase === 'result-hold';
  const result = 'result' in presentedAnimation ? presentedAnimation.result : undefined;
  const timingGrade = getPresentationTimingGrade(presentedAnimation);
  const fallCount = 'fallCount' in presentedAnimation ? presentedAnimation.fallCount ?? 0 : 0;
  const turnOrder = 'turnOrder' in presentedAnimation ? presentedAnimation.turnOrder : false;
  const hasSettled = settledAnimationId === presentedAnimation.id;
  const isVisualLanding = isLanding || (isResultHold && !hasSettled);
  const shouldShowResult = Boolean(result) && hasSettled && !isPreResult && !isLanding;
  const hasResolvedResult = (isLanding || isResultHold || Boolean(result)) && Boolean(result);
  const isBonusResult = hasResolvedResult && !turnOrder && !fallCount && (result?.name === '윷' || result?.name === '모');
  const phaseClass = isPreResult ? `pending-roll ${presentedAnimation.phase === 'extra-spin' ? 'extra-spin-roll' : 'primary-roll'}` : isVisualLanding ? 'resolved-from-pending resolved-roll landing-roll' : isResultHold ? 'resolved-from-pending resolved-roll result-hold-roll' : 'resolved-roll';
  return <div ref={rollStageRef} className={`roll-stage ${phaseClass}`} data-settle-source={settleSource} role="status" aria-live="polite">
    <div className="roll-aura" aria-hidden="true"></div>
    <div className="roll-impact-burst" aria-hidden="true">{Array.from({ length: 10 }, (_, index) => <span key={`spark-${presentedAnimation.id}-${index}`} style={{ '--spark-index': index } as CSSProperties}></span>)}</div>
    <div data-testid="roll-mat" className={`roll-mat ${isBonusResult ? 'bonus-roll' : ''} ${hasResolvedResult && fallCount ? 'fall-roll' : ''}`} onAnimationEnd={(event) => {
      if (isPreResult) return;
      const target = event.target;
      if (!(target instanceof HTMLElement) || !target.classList.contains('yut-stick')) return;
      const scene = target.closest<HTMLElement>('[data-testid="yut-roll-scene"]');
      if (scene?.dataset.renderer !== 'fallback') return;
      const sticks = scene.querySelectorAll<HTMLElement>('.yut-stick');
      if (sticks.item(sticks.length - 1) !== target) return;
      markCurrentAnimationSettled('css-animation-end');
    }}>
      <span data-testid="roll-mat-surface" className="roll-mat-surface" aria-hidden="true">
        <span className="roll-mat-depth"></span>
        <span className="roll-mat-inlay"></span>
        <span className="roll-mat-corner roll-mat-corner-nw"></span>
        <span className="roll-mat-corner roll-mat-corner-ne"></span>
        <span className="roll-mat-corner roll-mat-corner-sw"></span>
        <span className="roll-mat-corner roll-mat-corner-se"></span>
        <span className="roll-mat-leg roll-mat-leg-left"></span>
        <span className="roll-mat-leg roll-mat-leg-right"></span>
      </span>
      {timingGrade && <span className={`roll-timing-feedback roll-stage-timing ${timingGrade}`}>{TIMING_GRADE_LABELS[timingGrade]}</span>}
      {hasResolvedResult && result && <span className={shouldShowResult ? 'roll-label' : 'roll-label-placeholder'} hidden={!shouldShowResult} aria-hidden={!shouldShowResult}>{fallCount ? '낙!' : result.name}</span>}
      <YutRollScenePhysics rollAnimation={presentedAnimation} onSettled={() => {
        const scene = rollStageRef.current?.querySelector<HTMLElement>('[data-testid="yut-roll-scene"]');
        if (scene?.dataset.renderer === 'fallback') {
          const animations = Array.from(scene.querySelectorAll<HTMLElement>('.yut-stick')).flatMap((stick) => stick.getAnimations());
          const allAnimationsFinished = animations.every((animation) => animation.playState === 'finished' || animation.playState === 'idle');
          if (allAnimationsFinished) markCurrentAnimationSettled('css-animation-end');
          return;
        }
        markCurrentAnimationSettled('three-renderer');
      }} />
    </div>
  </div>;
}
