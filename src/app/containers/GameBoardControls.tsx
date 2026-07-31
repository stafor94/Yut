import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { ITEM_DEFINITIONS, type ItemType } from '../../features/items/logic/items';
import {
  TURN_END_HOLD_MS,
  TURN_ITEM_PROMPT_TIMEOUT_MS,
  TURN_START_DELAY_MS,
  getTurnActionTimeoutMsForCount,
  incrementTurnActionTimeoutCount,
  normalizeTurnActionTimeoutCount,
} from '../../features/room/services/roomTiming';
import { runWithRollTimeoutRandom } from '../../features/room/services/timeoutResolvers';
import { markNextDeadlineAutoAction } from '../../features/room/services/turnActionStartedAtPolicy';
import {
  getTurnActionDeadlineDelayMs,
  getTurnActionReadyAt,
  getTurnDisplayAt,
  isTurnActionDeadlineExpired,
  normalizeTurnDeadlineAt,
  normalizeTurnDeadlineKind,
  type TurnActionPhase,
  type TurnDeadlineKind,
  type TurnTransitionPhase,
} from '../../features/room/services/turnDeadlinePolicy';
import type { BranchChoice } from '../../game-core/board/board';
import type { YutResult } from '../../game-core/roll';
import {
  findFirstSelectableRollStackIndex,
  isRollStackIndexSelectable,
} from '../../game-core/rollStackSelection';
import { playStoredSoundEffect } from '../../shared/audio/sound';
import { RollTimingControl } from '../components/RollTimingControl';
import { createDeadlineTimerAnimationCache } from '../flows/deadlineTimerAnimation';
import { getRollControlPresentation, shouldAutoScrollGameControls } from '../flows/rollControlPresentation';
import { isTurnActionPresentationPending } from '../flows/turnActionPresentationPolicy';
import { shouldPlayLocalTurnSound } from '../flows/turnSound';
import { scheduleTurnTransitionBoundary } from '../flows/turnTransitionClock';

const AUTO_ACTION_LEAD_MS = 80;

type GameBoardControlsProps = {
  roll: YutResult | null;
  stackedRollMode: boolean;
  rollStack: YutResult[];
  rollStackSelectionAvailability: boolean[];
  selectedRollStackIndex: number | null;
  rollStackClosed: boolean;
  onSelectRollStackIndex: (index: number) => void;
  onMoveRollStackIndex: (index: number) => void;
  moveSelectionTimedOut: boolean;
  activeItemPromptTypes: ItemType[];
  localSeatId: string;
  getItemPromptTimeoutMs: (seatId?: string) => number;
  onUseItem: (type: ItemType) => void;
  onSkipItemPrompt: (options?: { timedOut?: boolean }) => void;
  showBottomBranchControls: boolean;
  displayBranchChoice: BranchChoice;
  onBranchChoiceChange: (choice: BranchChoice) => void;
  canRequestMove: boolean;
  activeSeatId?: string;
  activeSeatTurnText: string;
  getTurnActionTimeoutMs: (seatId?: string) => number;
  turnActionTimeoutMs: number;
  onMoveSelectedPiece: () => void;
  canRollNow: boolean;
  canSubmitTurnAction: boolean;
  onRollYut: (options?: { timedOut?: boolean; timingPositionPercent?: number } | number) => void;
  rollResultHolding: boolean;
  pendingTrapPlacement: boolean;
  waitingForOnlineTurnOrder: boolean;
  hasActiveTurnOrderIntro: boolean;
  canRollForTurnOrderNow: boolean;
  turnDeadlineAt: number;
  turnDeadlineKind: TurnDeadlineKind;
  timeoutCountBySeatId: Record<string, number>;
  authoritativeActiveSeatId?: string;
  autoPlayActive: boolean;
  autoPlaySeatName: string;
  localAutoPlayActive: boolean;
  resumeHumanControlPending: boolean;
  onResumeHumanControl: () => void;
};

type LocalTurnTransition = {
  key: string;
  displayAt: number;
  readyAt: number;
  holdFromReceipt: boolean;
};

export function GameBoardControls({
  roll,
  stackedRollMode,
  rollStack,
  rollStackSelectionAvailability,
  selectedRollStackIndex,
  rollStackClosed,
  onSelectRollStackIndex,
  onMoveRollStackIndex,
  moveSelectionTimedOut,
  activeItemPromptTypes,
  localSeatId,
  getItemPromptTimeoutMs,
  onUseItem,
  onSkipItemPrompt,
  showBottomBranchControls,
  displayBranchChoice,
  onBranchChoiceChange,
  canRequestMove,
  activeSeatId,
  activeSeatTurnText,
  getTurnActionTimeoutMs,
  turnActionTimeoutMs,
  onMoveSelectedPiece,
  canRollNow,
  canSubmitTurnAction,
  onRollYut,
  rollResultHolding,
  pendingTrapPlacement,
  waitingForOnlineTurnOrder,
  hasActiveTurnOrderIntro,
  canRollForTurnOrderNow,
  turnDeadlineAt,
  turnDeadlineKind,
  timeoutCountBySeatId: authoritativeTimeoutCountBySeatId,
  authoritativeActiveSeatId,
  autoPlayActive,
  autoPlaySeatName,
  localAutoPlayActive,
  resumeHumanControlPending,
  onResumeHumanControl,
}: GameBoardControlsProps) {
  const controlsRef = useRef<HTMLDivElement | null>(null);
  const soundTurnRef = useRef({ seatId: '', version: 0 });
  const lastPlayedTurnSoundKeyRef = useRef('');
  const timeoutRecordedKeyRef = useRef('');
  const autoTurnActionKeyRef = useRef('');
  const autoItemPromptKeyRef = useRef('');
  const timedOutRollCommitKeyRef = useRef('');
  const onRollYutRef = useRef(onRollYut);
  const onMoveSelectedPieceRef = useRef(onMoveSelectedPiece);
  const onMoveRollStackIndexRef = useRef(onMoveRollStackIndex);
  const onSkipItemPromptRef = useRef(onSkipItemPrompt);
  const localTransitionRef = useRef<LocalTurnTransition>({ key: '', displayAt: 0, readyAt: 0, holdFromReceipt: false });
  onRollYutRef.current = onRollYut;
  onMoveSelectedPieceRef.current = onMoveSelectedPiece;
  onMoveRollStackIndexRef.current = onMoveRollStackIndex;
  onSkipItemPromptRef.current = onSkipItemPrompt;

  const [turnActionTimedOut, setTurnActionTimedOut] = useState(false);
  const [itemPromptTimedOut, setItemPromptTimedOut] = useState(false);
  const [turnActionTimerAnimationCache] = useState(() => createDeadlineTimerAnimationCache());
  const [itemPromptTimerAnimationCache] = useState(() => createDeadlineTimerAnimationCache());
  const [timeoutCountBySeatId, setTimeoutCountBySeatId] = useState<Record<string, number>>(authoritativeTimeoutCountBySeatId);
  const [, setTransitionClock] = useState(() => Date.now());
  const authoritativeTurnDeadline = {
    at: normalizeTurnDeadlineAt(turnDeadlineAt),
    kind: normalizeTurnDeadlineKind(turnDeadlineKind),
  };
  const actionableTurnKey = activeSeatId && !waitingForOnlineTurnOrder && !hasActiveTurnOrderIntro ? activeSeatId : '';
  if (localTransitionRef.current.key !== actionableTurnKey) {
    const now = Date.now();
    const hadPreviousTurn = Boolean(localTransitionRef.current.key && actionableTurnKey);
    localTransitionRef.current = {
      key: actionableTurnKey,
      displayAt: actionableTurnKey ? now + (hadPreviousTurn ? TURN_END_HOLD_MS : 0) : 0,
      readyAt: actionableTurnKey ? now + (hadPreviousTurn ? TURN_END_HOLD_MS : 0) + TURN_START_DELAY_MS : 0,
      holdFromReceipt: hadPreviousTurn,
    };
  }

  const isOpponentTurn = Boolean(actionableTurnKey && activeSeatId !== localSeatId);
  const canShowLocalRollStack = canSubmitTurnAction && stackedRollMode && rollStackClosed;
  const showRollStackPicker = canShowLocalRollStack && rollStack.length >= 2 && selectedRollStackIndex === null;
  const showRollStackMoveButton = canShowLocalRollStack && rollStack.length > 0 && !showRollStackPicker;
  const turnActionPhase: TurnActionPhase = roll || rollStackClosed ? 'move' : 'roll';
  const turnActionTimerKey = `${activeSeatId ?? ''}:${turnActionPhase}:${rollStack.length}`;
  const itemPromptTimerKey = `${activeSeatId ?? localSeatId}:${activeItemPromptTypes.join('|')}`;
  const timerSeatId = activeSeatId ?? localSeatId;
  const timerTimeoutCount = timeoutCountBySeatId[timerSeatId];
  const localTimeoutCount = timeoutCountBySeatId[localSeatId];
  const timerDurationMs = useMemo(
    () => getTurnActionTimeoutMsForCount(timerTimeoutCount, turnActionTimeoutMs),
    [timerSeatId, timerTimeoutCount, turnActionTimerKey, turnActionTimeoutMs],
  );
  const itemPromptFallbackDurationMs = useMemo(
    () => getTurnActionTimeoutMsForCount(localTimeoutCount, TURN_ITEM_PROMPT_TIMEOUT_MS),
    [itemPromptTimerKey, localSeatId, localTimeoutCount],
  );
  const deadlinePhase = activeItemPromptTypes.length > 0 ? 'item_prompt' : turnActionPhase;
  const deadlineDurationMs = activeItemPromptTypes.length > 0 ? itemPromptFallbackDurationMs : timerDurationMs;
  const hasAuthoritativeDeadline = authoritativeTurnDeadline.kind === deadlinePhase && authoritativeTurnDeadline.at > 0;
  const authoritativeReadyAt = hasAuthoritativeDeadline
    ? getTurnActionReadyAt({ deadlineAt: authoritativeTurnDeadline.at, durationMs: deadlineDurationMs })
    : 0;
  const authoritativeDisplayAt = authoritativeReadyAt
    ? getTurnDisplayAt({ deadlineAt: authoritativeTurnDeadline.at, durationMs: deadlineDurationMs, startDelayMs: TURN_START_DELAY_MS })
    : 0;
  const now = Date.now();
  const transitionDisplayAt = hasAuthoritativeDeadline
    ? localTransitionRef.current.holdFromReceipt
      ? Math.max(authoritativeDisplayAt, localTransitionRef.current.displayAt)
      : authoritativeDisplayAt
    : localTransitionRef.current.displayAt;
  const transitionReadyAt = hasAuthoritativeDeadline
    ? localTransitionRef.current.holdFromReceipt
      ? Math.max(authoritativeReadyAt, localTransitionRef.current.readyAt)
      : authoritativeReadyAt
    : localTransitionRef.current.readyAt;
  const transitionPhase: TurnTransitionPhase = !actionableTurnKey || !transitionReadyAt || now >= transitionReadyAt
    ? 'ready'
    : transitionDisplayAt && now < transitionDisplayAt ? 'ending' : 'starting';
  const actionReady = transitionPhase === 'ready';
  const soundSeatId = waitingForOnlineTurnOrder || hasActiveTurnOrderIntro ? '' : authoritativeActiveSeatId ?? '';
  if (soundTurnRef.current.seatId !== soundSeatId) {
    soundTurnRef.current = { seatId: soundSeatId, version: soundTurnRef.current.version + 1 };
  }
  const soundTurnKey = soundSeatId ? `${soundSeatId}:${soundTurnRef.current.version}` : '';
  const soundDurationMs = getTurnActionTimeoutMsForCount(
    timeoutCountBySeatId[soundSeatId],
    activeItemPromptTypes.length > 0 ? TURN_ITEM_PROMPT_TIMEOUT_MS : turnActionTimeoutMs,
  );
  const soundReadyAt = soundSeatId && authoritativeTurnDeadline.at
    ? getTurnActionReadyAt({ deadlineAt: authoritativeTurnDeadline.at, durationMs: soundDurationMs })
    : 0;
  const soundActionReady = Boolean(soundSeatId && (!soundReadyAt || now >= soundReadyAt));
  const turnActionDeadlineKey = `${turnActionTimerKey}:${authoritativeTurnDeadline.kind}:${authoritativeTurnDeadline.at}`;
  const itemPromptDeadlineKey = `${itemPromptTimerKey}:${authoritativeTurnDeadline.kind}:${authoritativeTurnDeadline.at}`;
  const turnActionDeadlineActive = authoritativeTurnDeadline.kind === turnActionPhase && authoritativeTurnDeadline.at > 0;
  const itemPromptDeadlineActive = authoritativeTurnDeadline.kind === 'item_prompt' && authoritativeTurnDeadline.at > 0;
  const turnActionPresentationPending = isTurnActionPresentationPending({
    phase: turnActionPhase,
    hasRoll: Boolean(roll),
    canRollNow,
    canSubmitTurnAction,
    rollResultHolding,
  });
  const turnActionTimerVisible = actionReady
    && Boolean(actionableTurnKey)
    && !autoPlayActive
    && !isOpponentTurn
    && activeItemPromptTypes.length === 0
    && !turnActionPresentationPending
    && turnActionDeadlineActive;
  const itemPromptTimerVisible = actionReady
    && !autoPlayActive
    && !isOpponentTurn
    && activeItemPromptTypes.length > 0
    && itemPromptDeadlineActive;
  const turnActionTimerAnimation = turnActionTimerAnimationCache.get({
    key: turnActionDeadlineKey,
    deadlineAt: turnActionDeadlineActive ? authoritativeTurnDeadline.at : 0,
    durationMs: timerDurationMs,
    active: turnActionTimerVisible,
  });
  const itemPromptTimerAnimation = itemPromptTimerAnimationCache.get({
    key: itemPromptDeadlineKey,
    deadlineAt: itemPromptDeadlineActive ? authoritativeTurnDeadline.at : 0,
    durationMs: itemPromptFallbackDurationMs,
    active: itemPromptTimerVisible,
  });
  const shouldAutoScrollControls = actionReady && shouldAutoScrollGameControls({
    hasRoll: Boolean(roll),
    canRollNow,
    canRollForTurnOrderNow,
    hasActiveTurnOrderIntro,
    showBottomBranchControls,
    canRequestMove,
  });

  useEffect(() => {
    const timestamps = Array.from(new Set([transitionDisplayAt, transitionReadyAt]))
      .filter((timestamp) => timestamp > Date.now())
      .sort((left, right) => left - right);
    if (!timestamps.length || typeof window === 'undefined') return undefined;
    const cancelTimers = timestamps.map((timestamp) => scheduleTurnTransitionBoundary(
      timestamp,
      () => setTransitionClock(Date.now()),
      {
        now: Date.now,
        setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs),
        clearTimeout: (timerId) => window.clearTimeout(timerId),
      },
    ));
    return () => cancelTimers.forEach((cancelTimer) => cancelTimer());
  }, [actionableTurnKey, authoritativeTurnDeadline.at, authoritativeTurnDeadline.kind, transitionDisplayAt, transitionReadyAt]);

  useEffect(() => {
    if (!soundTurnKey) return;
    const alreadyPlayed = lastPlayedTurnSoundKeyRef.current === soundTurnKey;
    if (shouldPlayLocalTurnSound({ currentActiveSeatId: soundSeatId, localSeatId, actionReady: soundActionReady, alreadyPlayed })) {
      lastPlayedTurnSoundKeyRef.current = soundTurnKey;
      playStoredSoundEffect('turn');
    }
  }, [localSeatId, soundActionReady, soundSeatId, soundTurnKey]);

  useEffect(() => {
    if (!shouldAutoScrollControls || typeof window === 'undefined') return undefined;
    if (!window.matchMedia('(orientation: portrait)').matches) return undefined;
    const timer = window.setTimeout(() => {
      controlsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end', inline: 'nearest' });
    }, 120);
    return () => window.clearTimeout(timer);
  }, [activeSeatId, actionReady, canRequestMove, canRollForTurnOrderNow, canRollNow, hasActiveTurnOrderIntro, roll, shouldAutoScrollControls, showBottomBranchControls]);

  useEffect(() => {
    setTimeoutCountBySeatId(Object.fromEntries(
      Object.entries(authoritativeTimeoutCountBySeatId)
        .map(([seatId, count]) => [seatId, normalizeTurnActionTimeoutCount(count)]),
    ));
  }, [authoritativeTimeoutCountBySeatId]);

  const recordTimeout = (seatId: string) => {
    if (!seatId) return;
    setTimeoutCountBySeatId((current) => ({
      ...current,
      [seatId]: incrementTurnActionTimeoutCount(current[seatId]),
    }));
  };
  const markTurnActionTimedOut = () => {
    setTurnActionTimedOut(true);
    if (timeoutRecordedKeyRef.current === turnActionDeadlineKey) return;
    timeoutRecordedKeyRef.current = turnActionDeadlineKey;
    recordTimeout(timerSeatId);
  };
  const resetTimeoutPenalty = (seatId: string) => {
    if (!seatId) return;
    setTimeoutCountBySeatId((current) => normalizeTurnActionTimeoutCount(current[seatId]) > 0
      ? { ...current, [seatId]: 0 }
      : current);
  };
  const hasExpired = (phase: TurnActionPhase) => isTurnActionDeadlineExpired({
    deadlineAt: authoritativeTurnDeadline.at,
    deadlineKind: authoritativeTurnDeadline.kind,
    phase,
  });
  const runTurnAction = (action: () => void, seatId = timerSeatId) => {
    if (!actionReady || turnActionTimedOut || hasExpired(turnActionPhase)) {
      if (actionReady && (turnActionTimedOut || hasExpired(turnActionPhase))) markTurnActionTimedOut();
      return;
    }
    resetTimeoutPenalty(seatId);
    action();
  };
  const runItemPromptAction = (action: () => void) => {
    if (!actionReady || itemPromptTimedOut || hasExpired('item_prompt')) {
      if (actionReady && (itemPromptTimedOut || hasExpired('item_prompt'))) setItemPromptTimedOut(true);
      return;
    }
    resetTimeoutPenalty(localSeatId);
    action();
  };

  useEffect(() => {
    setTurnActionTimedOut(false);
    timedOutRollCommitKeyRef.current = '';
  }, [turnActionDeadlineKey]);

  useEffect(() => {
    setItemPromptTimedOut(false);
  }, [itemPromptDeadlineKey]);

  useEffect(() => {
    if (!actionReady || autoPlayActive || !turnActionTimerVisible || turnActionPhase === 'roll' || !authoritativeTurnDeadline.at || typeof window === 'undefined') return undefined;
    const remainingMs = getTurnActionDeadlineDelayMs({
      deadlineAt: authoritativeTurnDeadline.at,
      deadlineKind: authoritativeTurnDeadline.kind,
      phase: turnActionPhase,
      fallbackMs: timerDurationMs,
    });
    if (remainingMs <= 0) {
      markTurnActionTimedOut();
      return undefined;
    }
    const runAutomaticAction = () => {
      if (autoTurnActionKeyRef.current === turnActionDeadlineKey) return;
      if (Date.now() >= authoritativeTurnDeadline.at) {
        markTurnActionTimedOut();
        return;
      }
      autoTurnActionKeyRef.current = turnActionDeadlineKey;
      if (turnActionPhase === 'move' && canRequestMove) {
        if (showRollStackPicker && rollStack.length > 0) {
          const selectedIndex = typeof selectedRollStackIndex === 'number'
            && isRollStackIndexSelectable(rollStackSelectionAvailability, selectedRollStackIndex)
            ? selectedRollStackIndex
            : null;
          const rollStackIndex = selectedIndex ?? findFirstSelectableRollStackIndex(rollStackSelectionAvailability);
          if (rollStackIndex !== null) {
            markNextDeadlineAutoAction({ actionType: 'move_piece', actorId: localSeatId, deadlineAt: authoritativeTurnDeadline.at });
            onMoveRollStackIndexRef.current(rollStackIndex);
          }
        } else {
          markNextDeadlineAutoAction({ actionType: 'move_piece', actorId: localSeatId, deadlineAt: authoritativeTurnDeadline.at });
          onMoveSelectedPieceRef.current();
        }
      }
      markTurnActionTimedOut();
    };
    const timer = window.setTimeout(runAutomaticAction, Math.max(0, remainingMs - AUTO_ACTION_LEAD_MS));
    return () => window.clearTimeout(timer);
  }, [actionReady, autoPlayActive, authoritativeTurnDeadline.at, authoritativeTurnDeadline.kind, canRequestMove, canRollNow, localSeatId, roll, rollStack.length, rollStackSelectionAvailability, selectedRollStackIndex, showRollStackPicker, timerDurationMs, timerSeatId, turnActionDeadlineKey, turnActionPhase, turnActionTimerVisible]);

  useEffect(() => {
    if (!actionReady || autoPlayActive || isOpponentTurn || activeItemPromptTypes.length === 0 || !localSeatId || !authoritativeTurnDeadline.at || typeof window === 'undefined') return undefined;
    const remainingMs = getTurnActionDeadlineDelayMs({
      deadlineAt: authoritativeTurnDeadline.at,
      deadlineKind: authoritativeTurnDeadline.kind,
      phase: 'item_prompt',
      fallbackMs: itemPromptFallbackDurationMs,
    });
    if (remainingMs <= 0) {
      setItemPromptTimedOut(true);
      return undefined;
    }
    const runAutomaticSkip = () => {
      if (autoItemPromptKeyRef.current === itemPromptDeadlineKey) return;
      if (Date.now() >= authoritativeTurnDeadline.at) {
        setItemPromptTimedOut(true);
        return;
      }
      autoItemPromptKeyRef.current = itemPromptDeadlineKey;
      setItemPromptTimedOut(true);
      recordTimeout(localSeatId);
      markNextDeadlineAutoAction({ actionType: 'use_item', actorId: localSeatId, deadlineAt: authoritativeTurnDeadline.at });
      onSkipItemPromptRef.current({ timedOut: true });
    };
    const timer = window.setTimeout(runAutomaticSkip, Math.max(0, remainingMs - AUTO_ACTION_LEAD_MS));
    return () => window.clearTimeout(timer);
  }, [actionReady, activeItemPromptTypes.length, autoPlayActive, authoritativeTurnDeadline.at, authoritativeTurnDeadline.kind, isOpponentTurn, itemPromptDeadlineKey, itemPromptFallbackDurationMs, localSeatId]);

  const handleRollButtonClick = (timingPositionPercent?: number, options: { timedOut?: boolean } = {}) => {
    if (options.timedOut) {
      if (!actionReady || autoPlayActive || !authoritativeTurnDeadline.at) return;
      if (timedOutRollCommitKeyRef.current === turnActionDeadlineKey) return;
      timedOutRollCommitKeyRef.current = turnActionDeadlineKey;
      markTurnActionTimedOut();
      runWithRollTimeoutRandom(authoritativeTurnDeadline.at, () => {
        onRollYutRef.current({ timedOut: true, timingPositionPercent });
      });
      return;
    }
    runTurnAction(() => {
      if (roll) {
        onMoveSelectedPiece();
        return;
      }
      onRollYut(timingPositionPercent);
    });
  };

  const rollControlPresentation = getRollControlPresentation({
    hasRoll: Boolean(roll),
    canRollNow,
    showRollStackPicker,
    timedOut: turnActionTimedOut,
  });
  const actionButtonText = turnActionTimedOut
    ? '시간 초과 처리 중...'
    : transitionPhase === 'ending'
      ? '턴 전환 중...'
      : transitionPhase === 'starting'
        ? '잠시 후 행동 가능'
        : roll
          ? (rollResultHolding ? '결과 확인 중...' : '선택한 말 이동')
          : pendingTrapPlacement ? '함정 설치 대기 중'
            : waitingForOnlineTurnOrder ? '게임 시작 대기 중'
              : hasActiveTurnOrderIntro ? '결과 확인 중' : '윷 던지기';
  const rollTimingResetKey = `${turnActionDeadlineKey}:${timerDurationMs}`;
  const rollTimingStartedAt = turnActionDeadlineActive
    ? getTurnActionReadyAt({ deadlineAt: authoritativeTurnDeadline.at, durationMs: timerDurationMs })
    : 0;
  const showRollTimingControl = actionReady
    && Boolean(actionableTurnKey)
    && !turnActionTimedOut
    && !turnActionPresentationPending
    && !roll
    && !showRollStackPicker
    && turnActionDeadlineActive;

  void getItemPromptTimeoutMs;
  void getTurnActionTimeoutMs;

  const turnActionTimerStyle = { '--timer-duration': `${turnActionTimerAnimation.durationMs}ms` } as CSSProperties;
  const turnActionTimerFillStyle = { animationDelay: `${turnActionTimerAnimation.delayMs}ms` } as CSSProperties;
  const itemPromptTimerStyle = { '--timer-duration': `${itemPromptTimerAnimation.durationMs}ms` } as CSSProperties;
  const itemPromptTimerFillStyle = { animationDelay: `${itemPromptTimerAnimation.delayMs}ms` } as CSSProperties;

  return <div
    ref={controlsRef}
    data-testid="play-controls"
    className={`play-controls ${isOpponentTurn ? 'opponent-turn' : 'local-turn'} ${!roll ? 'roll-ready' : ''} ${showBottomBranchControls && !isOpponentTurn ? 'branch-choice-mode' : ''} ${activeItemPromptTypes.length && !isOpponentTurn ? 'item-prompt-mode' : ''} ${autoPlayActive ? 'auto-play-mode' : ''}`}
  >
    {autoPlayActive ? <div data-testid="auto-play-control-panel" className="auto-play-control-panel" role="status" aria-live="polite">
      <strong className="auto-play-control-title">AI 자동 플레이 중...</strong>
      <span className="auto-play-control-description">{autoPlaySeatName}님의 행동을 어려움 AI가 대신 판단합니다.</span>
      {localAutoPlayActive && <button
        type="button"
        data-testid="resume-human-control-button"
        className="resume-human-control-button"
        onClick={onResumeHumanControl}
        disabled={resumeHumanControlPending}
      >
        {resumeHumanControlPending ? '통제권 가져오는 중...' : '직접 플레이로 돌아가기'}
      </button>}
    </div> : transitionPhase === 'ending' ? <button data-testid="turn-transition-button" className="roll-button" disabled>턴 전환 중...</button> : isOpponentTurn ? <button data-testid="turn-waiting-button" className="roll-button" disabled>{activeSeatTurnText} 차례</button> : activeItemPromptTypes.length > 0 ? <div className="inline-item-prompt" role="dialog" aria-label="아이템 사용 선택">
      <div><strong>아이템을 사용할까요?</strong></div>
      {itemPromptTimerVisible && <div key={`${itemPromptDeadlineKey}:${itemPromptFallbackDurationMs}`} className="time-limit-bar item-prompt-timer" style={itemPromptTimerStyle} data-deadline-at={authoritativeTurnDeadline.at} data-animation-delay-ms={itemPromptTimerAnimation.delayMs} aria-hidden="true"><span style={itemPromptTimerFillStyle}></span></div>}
      {itemPromptTimedOut && <div data-testid="item-timeout-status" role="status" aria-live="polite">시간 초과 처리 중...</div>}
      <div className="inline-item-actions">
        {activeItemPromptTypes.map((type, index) => <button className="inline-item-button" key={`${type}-${index}`} onClick={() => runItemPromptAction(() => onUseItem(type))} disabled={!actionReady || itemPromptTimedOut}><span>{ITEM_DEFINITIONS[type].icon}</span>{ITEM_DEFINITIONS[type].name}</button>)}
        <button className="secondary" onClick={() => runItemPromptAction(() => onSkipItemPrompt())} disabled={!actionReady || itemPromptTimedOut}>사용 안 함</button>
      </div>
    </div> : showBottomBranchControls ? <div className="bottom-branch-controls" aria-label="이동 방향 선택">
      <button type="button" className={displayBranchChoice === 'outer' ? 'active' : ''} onClick={() => runTurnAction(() => onBranchChoiceChange('outer'))} disabled={!actionReady || turnActionTimedOut}>바깥길</button>
      <button type="button" className={displayBranchChoice === 'shortcut' ? 'active' : ''} onClick={() => runTurnAction(() => onBranchChoiceChange('shortcut'))} disabled={!actionReady || turnActionTimedOut}>지름길</button>
      {turnActionTimerVisible && <div key={`${turnActionDeadlineKey}:${timerDurationMs}`} className="time-limit-bar turn-action-timer" style={turnActionTimerStyle} data-deadline-at={authoritativeTurnDeadline.at} data-animation-delay-ms={turnActionTimerAnimation.delayMs} aria-hidden="true"><span style={turnActionTimerFillStyle}></span></div>}
      <button type="button" data-testid="move-piece-button" className="branch-move-button" onClick={() => runTurnAction(onMoveSelectedPiece)} disabled={!actionReady || turnActionTimedOut || !canRequestMove}>{actionButtonText}</button>
    </div> : <>
      {turnActionTimerVisible && <div key={`${turnActionDeadlineKey}:${timerDurationMs}`} className="time-limit-bar turn-action-timer" style={turnActionTimerStyle} data-deadline-at={authoritativeTurnDeadline.at} data-animation-delay-ms={turnActionTimerAnimation.delayMs} aria-hidden="true"><span style={turnActionTimerFillStyle}></span></div>}
      {showRollStackPicker && <div className="roll-stack-picker" aria-label="이동 스택 선택"><div className="roll-stack-options">{rollStack.map((entry, index) => <button type="button" key={`${entry.name}-${index}`} onClick={() => {
        if (!isRollStackIndexSelectable(rollStackSelectionAvailability, index)) return;
        runTurnAction(() => moveSelectionTimedOut ? onMoveRollStackIndex(index) : onSelectRollStackIndex(index));
      }} disabled={!actionReady || turnActionTimedOut || !isRollStackIndexSelectable(rollStackSelectionAvailability, index)}>{entry.name}</button>)}</div></div>}
      {turnActionTimedOut && showRollStackPicker && <div data-testid="turn-timeout-status" role="status" aria-live="polite">시간 초과 처리 중...</div>}
      {showRollTimingControl && <RollTimingControl resetKey={rollTimingResetKey} timingStartedAt={rollTimingStartedAt} autoSubmitAt={authoritativeTurnDeadline.at} buttonTestId={rollControlPresentation.actionButtonTestId} buttonText={actionButtonText} onRoll={handleRollButtonClick} disabled={!canRollNow} />}
      {(!showRollTimingControl || !actionReady) && !showRollStackPicker && <button data-testid={rollControlPresentation.actionButtonTestId} className={!roll ? 'roll-button' : undefined} onClick={() => handleRollButtonClick()} disabled={!actionReady || turnActionTimedOut || (!canRollNow && !roll) || Boolean((roll || showRollStackMoveButton) && !canRequestMove)}>{showRollStackMoveButton && actionReady && !turnActionTimedOut ? '선택한 말 이동' : actionButtonText}</button>}
    </>}
  </div>;
}
