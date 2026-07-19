import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { YutResult } from '../../game-core/roll';
import { gamePresentationLock } from '../../shared/gamePresentationLock';
import { YutRollScenePhysics } from '../components/YutRollScenePhysics';
import {
  createGameAnimationSequence,
  gameAnimationQueue,
  getRollPresentationAnimationId,
  type GameAnimationSequence,
} from '../flows/gameAnimationQueue';
import {
  dismissGoldenYutPicker,
  EMPTY_GOLDEN_YUT_PICKER_PRESENTATION_STATE,
  markGoldenYutRollPresentationCompleted,
  shouldShowGoldenYutPicker,
  syncGoldenYutPickerOpenState,
} from '../flows/goldenYutPickerPresentation';
import {
  EMPTY_ROLL_PRESENTATION_STATE,
  isRollPresentationResultVisible,
  type RollPresentationState,
} from '../flows/rollPresentationVisibility';
import {
  createRollPresentationCompletion,
  type RollPresentationCompletion,
  type RollPresentationSettleSource,
  type RollPresentationVisualResult,
} from '../flows/rollPresentationCompletion';
import type { RollAnimation, ToastMessage } from '../appState';

export type { RollPresentationState } from '../flows/rollPresentationVisibility';

type RollPresentationCompletedListener = () => void;
const rollPresentationCompletedListeners = new Set<RollPresentationCompletedListener>();

const subscribeRollPresentationCompleted = (listener: RollPresentationCompletedListener) => {
  rollPresentationCompletedListeners.add(listener);
  return () => {
    rollPresentationCompletedListeners.delete(listener);
  };
};

const notifyRollPresentationCompleted = () => {
  rollPresentationCompletedListeners.forEach((listener) => listener());
};

type FallPresentationActiveListener = (active: boolean) => void;
const fallPresentationActiveListeners = new Set<FallPresentationActiveListener>();
let currentFallPresentationActive = false;

const subscribeFallPresentationActive = (listener: FallPresentationActiveListener) => {
  fallPresentationActiveListeners.add(listener);
  listener(currentFallPresentationActive);
  return () => {
    fallPresentationActiveListeners.delete(listener);
  };
};

const notifyFallPresentationActive = (active: boolean) => {
  if (currentFallPresentationActive === active) return;
  currentFallPresentationActive = active;
  fallPresentationActiveListeners.forEach((listener) => listener(active));
};

type WinnerOverlayProps = {
  winner: string;
  winnerText: ReactNode;
  canContinueRace: boolean;
  onReturnToWaitingRoom: () => void;
  onExitToLobby: () => void;
  onContinueRace: () => void;
};

export function WinnerOverlay({ winner, winnerText, onReturnToWaitingRoom, onExitToLobby }: WinnerOverlayProps) {
  const [visibleWinner, setVisibleWinner] = useState('');

  useEffect(() => {
    if (!winner) {
      setVisibleWinner('');
      return;
    }
    const frameId = window.requestAnimationFrame(() => setVisibleWinner(winner));
    return () => window.cancelAnimationFrame(frameId);
  }, [winner]);

  if (!winner || visibleWinner !== winner) return null;
  return <div data-testid="winner-overlay" className="winner-overlay" role="status" aria-live="assertive">
    <span>게임 종료</span>
    <strong>{winnerText}</strong>
    <button onClick={onReturnToWaitingRoom}>대기실로 돌아가기</button>
    <button className="secondary" onClick={onExitToLobby}>로비로 나가기</button>
  </div>;
}

type GoldenYutPickerProps = {
  isOpen: boolean;
  choices: YutResult[];
  onSelect: (choice: YutResult) => void;
};

export function GoldenYutPicker({ isOpen, choices, onSelect }: GoldenYutPickerProps) {
  const isOpenRef = useRef(isOpen);
  const [presentationState, setPresentationState] = useState(EMPTY_GOLDEN_YUT_PICKER_PRESENTATION_STATE);
  isOpenRef.current = isOpen;

  useEffect(() => subscribeRollPresentationCompleted(() => {
    setPresentationState((current) => syncGoldenYutPickerOpenState(
      markGoldenYutRollPresentationCompleted(current),
      isOpenRef.current,
    ));
  }), []);

  useEffect(() => {
    setPresentationState((current) => syncGoldenYutPickerOpenState(current, isOpen));
  }, [isOpen]);

  if (!shouldShowGoldenYutPicker(presentationState, isOpen)) return null;
  return <div data-testid="golden-yut-picker" className="golden-yut-picker" role="dialog" aria-modal="true" aria-label="황금 윷 결과 선택">
    <h2>황금 윷 결과 선택</h2>
    <p>원하는 결과를 고르면 다음 윷 던지기가 반드시 그 결과로 나옵니다.</p>
    <div>{choices.map((choice) => <button key={choice.name} onClick={() => {
      setPresentationState(dismissGoldenYutPicker());
      onSelect(choice);
    }}>{choice.name}</button>)}</div>
  </div>;
}

type TurnIndicatorProps = {
  color?: string;
  showNeighbors: boolean;
  previousText: ReactNode;
  previousColor?: string;
  currentText: ReactNode;
  currentRollStack: YutResult[];
  nextText: ReactNode;
  nextColor?: string;
};

type TurnNeighborSnapshot = Pick<TurnIndicatorProps, 'previousText' | 'previousColor' | 'nextText' | 'nextColor'>;

const getTurnIndicatorSnapshotKey = (currentText: ReactNode) => (
  typeof currentText === 'string' || typeof currentText === 'number' ? String(currentText) : ''
);

export function TurnIndicator({ color, showNeighbors, previousText, previousColor, currentText, currentRollStack, nextText, nextColor }: TurnIndicatorProps) {
  const initialNeighbors = { previousText, previousColor, nextText, nextColor };
  const lastVisibleNeighborsRef = useRef<TurnNeighborSnapshot>(initialNeighbors);
  const neighborsByCurrentTextRef = useRef<Map<string, TurnNeighborSnapshot>>(new Map());
  const [keepNeighborsVisible, setKeepNeighborsVisible] = useState(currentFallPresentationActive);

  useEffect(() => subscribeFallPresentationActive(setKeepNeighborsVisible), []);

  if (showNeighbors) {
    const visibleNeighbors = { previousText, previousColor, nextText, nextColor };
    lastVisibleNeighborsRef.current = visibleNeighbors;
    const snapshotKey = getTurnIndicatorSnapshotKey(currentText);
    if (snapshotKey) neighborsByCurrentTextRef.current.set(snapshotKey, visibleNeighbors);
  }

  const renderNeighbors = showNeighbors || keepNeighborsVisible;
  const frozenSnapshotKey = getTurnIndicatorSnapshotKey(currentText);
  const visibleNeighbors = showNeighbors
    ? { previousText, previousColor, nextText, nextColor }
    : neighborsByCurrentTextRef.current.get(frozenSnapshotKey) ?? lastVisibleNeighborsRef.current;

  return <div data-testid="turn-indicator" className="turn-indicator">
    {renderNeighbors && <span className="turn-neighbor previous-turn" style={{ color: visibleNeighbors.previousColor }}>{visibleNeighbors.previousText}</span>}
    {renderNeighbors && <span className="turn-separator" aria-hidden="true">&gt;</span>}
    <strong className="turn-current" style={{ '--turn-current-color': color } as CSSProperties}>
      <span className="turn-current-badge">{currentText}</span>
      {currentRollStack.length > 0 && <span className="turn-roll-stack-badges" aria-label={`남은 이동 스택: ${currentRollStack.map((entry) => entry.name).join(', ')}`}>{currentRollStack.map((entry, index) => <span key={`${entry.name}-${index}`} className="turn-roll-stack-badge">{entry.name}</span>)}</span>}
    </strong>
    {renderNeighbors && <span className="turn-separator" aria-hidden="true">&gt;</span>}
    {renderNeighbors && <span className="turn-neighbor next-turn" style={{ color: visibleNeighbors.nextColor }}>{visibleNeighbors.nextText}</span>}
  </div>;
}

type BoardMessageStackProps = {
  turnToast: { id: number; text: string } | null;
  toast: ToastMessage | null;
};

export function BoardMessageStack({ turnToast, toast }: BoardMessageStackProps) {
  if (!turnToast && !toast) return null;
  return <div className="board-message-stack" aria-live="polite">
    {turnToast && <div className="turn-toast board-toast" key={turnToast.id} role="status">{turnToast.text}</div>}
    {toast && <div className="toast-message board-toast" role="status"><strong>{toast.icon} {toast.title}</strong>{toast.description && <span>{toast.description}</span>}</div>}
  </div>;
}

type RollStageProps = {
  rollAnimation: RollAnimation | null;
  presentationActorId?: string;
  onPresentationChange?: (state: RollPresentationState) => void;
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
  const activeRollSequenceIdRef = useRef<number | null>(null);
  const currentLiveSequenceIdRef = useRef<number | null>(null);
  const completedLiveSequenceIdsRef = useRef<Set<number>>(new Set());
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
      if (visualResult === 'cancelled') return;
      if (!mountedRef.current || presentedAnimationRef.current?.id !== queuedAnimation.id) return;
      setSettleSource(visualResult);
      if (visualResult === 'watchdog') {
        console.warn('윷 애니메이션 렌더러 완료 신호가 없어 watchdog으로 결과를 확정합니다.', {
          animationId: queuedAnimation.id,
          sourceAnimationId,
        });
        setSettledAnimationId(queuedAnimation.id);
      }
      const holdResult = await completion.waitForResultHold();
      if (holdResult === 'cancelled') return;
    } finally {
      presentationCompletionByIdRef.current.delete(queuedAnimation.id);
    }
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
      if (!resolvedAnimation || !mountedRef.current) return;
      if (completedLiveSequenceIdsRef.current.has(sourceAnimationId)) {
        if (presentedLive || presentedSourceAnimationIdRef.current === sourceAnimationId) {
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
      if (currentLiveSequenceIdRef.current === sourceAnimationId) currentLiveSequenceIdRef.current = null;
      completedLiveSequenceIdsRef.current.delete(sourceAnimationId);
      rollSequenceByIdRef.current.delete(sourceAnimationId);
      liveAnimationByIdRef.current.delete(sourceAnimationId);
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
      activeRollSequenceIdRef.current = null;
      currentLiveSequenceIdRef.current = null;
      completedLiveSequenceIdsRef.current.clear();
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
      const liveSequenceId = currentLiveSequenceIdRef.current;
      if (liveSequenceId !== null) {
        currentLiveSequenceIdRef.current = null;
        const sequence = rollSequenceByIdRef.current.get(liveSequenceId);
        if (sequence && !sequence.isSettled()) {
          completedLiveSequenceIdsRef.current.add(liveSequenceId);
          const terminalAnimation = liveAnimationByIdRef.current.get(liveSequenceId);
          if (terminalAnimation) sequence.resolve(terminalAnimation);
          else sequence.cancel();
          return;
        }
      }
      const currentAnimation = presentedAnimationRef.current;
      if (currentAnimation && isResolvedRollAnimation(currentAnimation) && queuedPresentationMetaRef.current.size > 0) return;
      presentAnimation(null);
      return;
    }

    const sourceAnimationId = rollAnimation.id;
    if (!isResolvedRollAnimation(rollAnimation)) {
      currentLiveSequenceIdRef.current = sourceAnimationId;
      const liveAnimation: RollAnimation = {
        ...rollAnimation,
        sticks: rollAnimation.sticks.map((stick) => ({ ...stick })),
      };
      liveAnimationByIdRef.current.set(sourceAnimationId, liveAnimation);
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

    if (currentLiveSequenceIdRef.current === sourceAnimationId) currentLiveSequenceIdRef.current = null;
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
      {presentedAnimation.timingZone && <span className={`roll-timing-feedback roll-stage-timing ${presentedAnimation.timingZone}`}>{presentedAnimation.timingZone === 'perfect' ? 'Perfect!' : presentedAnimation.timingZone === 'good' ? 'Good!' : 'Normal'}</span>}
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
