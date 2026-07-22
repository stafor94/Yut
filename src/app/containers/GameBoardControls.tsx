import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { ITEM_DEFINITIONS, type ItemType } from '../../features/items/logic/items';
import { subscribeGameState } from '../../features/room/services/roomService';
import {
  TURN_ITEM_PROMPT_TIMEOUT_MS,
  getTurnActionTimeoutMsForCount,
  incrementTurnActionTimeoutCount,
  normalizeTurnActionTimeoutCount,
} from '../../features/room/services/roomTiming';
import {
  getTurnActionDeadlineDelayMs,
  isTurnActionDeadlineExpired,
  normalizeTurnDeadlineAt,
  normalizeTurnDeadlineKind,
  type TurnDeadlineKind,
} from '../../features/room/services/turnDeadlinePolicy';
import type { BranchChoice } from '../../game-core/board/board';
import type { YutResult } from '../../game-core/roll';
import { playStoredSoundEffect } from '../../shared/audio/sound';
import { STORAGE_KEYS } from '../appState';
import { getRollControlPresentation, shouldAutoScrollGameControls } from '../flows/rollControlPresentation';

type GameBoardControlsProps = {
  roll: YutResult | null;
  stackedRollMode: boolean;
  rollStack: YutResult[];
  selectedRollStackIndex: number | null;
  rollStackClosed: boolean;
  onSelectRollStackIndex: (index: number) => void;
  onMoveRollStackIndex: (index: number) => void;
  moveSelectionTimedOut: boolean;
  activeItemPromptTypes: ItemType[];
  localSeatId: string;
  getItemPromptTimeoutMs: (seatId?: string) => number;
  onUseItem: (type: ItemType) => void;
  onSkipItemPrompt: () => void;
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
  onRollYut: (timingPositionPercent?: number) => void;
  rollResultHolding: boolean;
  pendingTrapPlacement: boolean;
  waitingForOnlineTurnOrder: boolean;
  hasActiveTurnOrderIntro: boolean;
  canRollForTurnOrderNow: boolean;
};

export function GameBoardControls({
  roll,
  stackedRollMode,
  rollStack,
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
}: GameBoardControlsProps) {
  const controlsRef = useRef<HTMLDivElement | null>(null);
  const rollTimingMeterRef = useRef<HTMLDivElement | null>(null);
  const rollTimingOrbRef = useRef<HTMLSpanElement | null>(null);
  const wasLocalTurnActiveRef = useRef(false);
  const timeoutRecordedKeyRef = useRef('');
  const [turnActionTimedOut, setTurnActionTimedOut] = useState(false);
  const [timeoutCountBySeatId, setTimeoutCountBySeatId] = useState<Record<string, number>>({});
  const [authoritativeTurnDeadline, setAuthoritativeTurnDeadline] = useState<{ at: number; kind: TurnDeadlineKind }>({ at: 0, kind: '' });
  const localTurnActive = Boolean(activeSeatId && activeSeatId === localSeatId && !waitingForOnlineTurnOrder && !hasActiveTurnOrderIntro);
  const shouldAutoScrollControls = shouldAutoScrollGameControls({
    hasRoll: Boolean(roll),
    canRollNow,
    canRollForTurnOrderNow,
    hasActiveTurnOrderIntro,
    showBottomBranchControls,
    canRequestMove,
  });
  const getVisibleRollTimingPositionPercent = () => {
    const meter = rollTimingMeterRef.current;
    const orb = rollTimingOrbRef.current;
    if (!meter || !orb) return undefined;
    const meterRect = meter.getBoundingClientRect();
    const orbRect = orb.getBoundingClientRect();
    if (meterRect.width <= 0) return undefined;
    const orbCenterX = orbRect.left + orbRect.width / 2;
    return Math.max(0, Math.min(100, ((orbCenterX - meterRect.left) / meterRect.width) * 100));
  };
  useEffect(() => {
    if (!localTurnActive) {
      wasLocalTurnActiveRef.current = false;
      return;
    }
    if (wasLocalTurnActiveRef.current) return;
    wasLocalTurnActiveRef.current = true;
    playStoredSoundEffect('turn');
  }, [localTurnActive]);
  useEffect(() => {
    if (!shouldAutoScrollControls || typeof window === 'undefined') return undefined;
    if (!window.matchMedia('(orientation: portrait)').matches) return undefined;
    const timer = window.setTimeout(() => {
      controlsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end', inline: 'nearest' });
    }, 120);
    return () => window.clearTimeout(timer);
  }, [activeSeatId, canRequestMove, canRollForTurnOrderNow, canRollNow, hasActiveTurnOrderIntro, roll, shouldAutoScrollControls, showBottomBranchControls]);
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const roomId = window.localStorage.getItem(STORAGE_KEYS.activeRoomId) ?? '';
    if (!roomId) return undefined;
    return subscribeGameState(roomId, (state) => {
      const syncedState = state as { turnActionTimeoutCountBySeatId?: unknown; turnDeadlineAt?: unknown; turnDeadlineKind?: unknown } | null;
      const nextDeadlineAt = normalizeTurnDeadlineAt(syncedState?.turnDeadlineAt);
      const nextDeadlineKind = normalizeTurnDeadlineKind(syncedState?.turnDeadlineKind);
      setAuthoritativeTurnDeadline((current) => current.at === nextDeadlineAt && current.kind === nextDeadlineKind
        ? current
        : { at: nextDeadlineAt, kind: nextDeadlineKind });

      const rawCounts = syncedState?.turnActionTimeoutCountBySeatId;
      if (!rawCounts || typeof rawCounts !== 'object' || Array.isArray(rawCounts)) {
        setTimeoutCountBySeatId({});
        return;
      }
      setTimeoutCountBySeatId(Object.fromEntries(
        Object.entries(rawCounts as Record<string, unknown>)
          .map(([seatId, count]) => [seatId, normalizeTurnActionTimeoutCount(count)]),
      ));
    });
  }, [localSeatId]);

  const isOpponentTurn = Boolean(activeSeatId && activeSeatId !== localSeatId);
  const canShowLocalRollStack = canSubmitTurnAction && stackedRollMode && rollStackClosed;
  const showRollStackPicker = canShowLocalRollStack && rollStack.length >= 2 && selectedRollStackIndex === null;
  const showRollStackMoveButton = canShowLocalRollStack && rollStack.length > 0 && !showRollStackPicker;
  const turnActionPhase = roll || rollStackClosed ? 'move' : 'roll';
  const turnActionTimerKey = `${activeSeatId ?? ''}:${turnActionPhase}:${rollStack.length}`;
  const itemPromptTimerKey = `${activeSeatId ?? localSeatId}:${activeItemPromptTypes.join('|')}`;
  const timerSeatId = activeSeatId ?? localSeatId;
  const timerTimeoutCount = timeoutCountBySeatId[timerSeatId];
  const localTimeoutCount = timeoutCountBySeatId[localSeatId];
  const timerDurationMs = useMemo(
    () => getTurnActionTimeoutMsForCount(timerTimeoutCount, turnActionTimeoutMs),
    [timerSeatId, timerTimeoutCount, turnActionTimerKey, turnActionTimeoutMs],
  );
  const itemPromptTimerDurationMs = useMemo(
    () => getTurnActionTimeoutMsForCount(localTimeoutCount, TURN_ITEM_PROMPT_TIMEOUT_MS),
    [itemPromptTimerKey, localSeatId, localTimeoutCount],
  );
  const turnActionDeadlineKey = `${turnActionTimerKey}:${authoritativeTurnDeadline.kind}:${authoritativeTurnDeadline.at}`;
  const turnActionTimerDurationMs = useMemo(() => getTurnActionDeadlineDelayMs({
    deadlineAt: authoritativeTurnDeadline.at,
    deadlineKind: authoritativeTurnDeadline.kind,
    phase: turnActionPhase,
    fallbackMs: timerDurationMs,
  }), [authoritativeTurnDeadline.at, authoritativeTurnDeadline.kind, timerDurationMs, turnActionPhase]);
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
  const runPlayerAction = (action: () => void, seatId = localSeatId) => {
    resetTimeoutPenalty(seatId);
    action();
  };
  const turnActionTimerVisible = !isOpponentTurn && activeItemPromptTypes.length === 0 && (
    showBottomBranchControls
      ? canRequestMove
      : showRollStackPicker || ((!roll && canRollNow) || (roll && canRequestMove))
  );

  useEffect(() => {
    setTurnActionTimedOut(false);
    if (!turnActionTimerVisible || typeof window === 'undefined') return undefined;
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
    const timer = window.setTimeout(markTurnActionTimedOut, remainingMs);
    return () => window.clearTimeout(timer);
  }, [authoritativeTurnDeadline.at, authoritativeTurnDeadline.kind, timerDurationMs, timerSeatId, turnActionDeadlineKey, turnActionPhase, turnActionTimerVisible]);

  useEffect(() => {
    if (isOpponentTurn || activeItemPromptTypes.length === 0 || !localSeatId || typeof window === 'undefined') return undefined;
    const timer = window.setTimeout(() => recordTimeout(localSeatId), itemPromptTimerDurationMs);
    return () => window.clearTimeout(timer);
  }, [activeItemPromptTypes.length, isOpponentTurn, itemPromptTimerDurationMs, itemPromptTimerKey, localSeatId]);

  const handleRollButtonClick = () => {
    if (turnActionTimedOut || isTurnActionDeadlineExpired({
      deadlineAt: authoritativeTurnDeadline.at,
      deadlineKind: authoritativeTurnDeadline.kind,
      phase: turnActionPhase,
    })) {
      markTurnActionTimedOut();
      return;
    }
    resetTimeoutPenalty(timerSeatId);
    if (roll) {
      onMoveSelectedPiece();
      return;
    }
    onRollYut(getVisibleRollTimingPositionPercent());
  };

  const rollControlPresentation = getRollControlPresentation({
    hasRoll: Boolean(roll),
    canRollNow,
    showRollStackPicker,
    timedOut: turnActionTimedOut,
  });
  const actionButtonText = roll
      ? (rollResultHolding ? '결과 확인 중...' : '선택한 말 이동')
      : pendingTrapPlacement ? '함정 설치 대기 중'
        : waitingForOnlineTurnOrder ? '순서 정하기 대기 중'
          : hasActiveTurnOrderIntro ? '결과 확인 중' : '윷 던지기';

  void getItemPromptTimeoutMs;
  void getTurnActionTimeoutMs;

  return <div ref={controlsRef} className={`play-controls ${isOpponentTurn ? 'opponent-turn' : 'local-turn'} ${!roll ? 'roll-ready' : ''} ${showBottomBranchControls && !isOpponentTurn ? 'branch-choice-mode' : ''} ${activeItemPromptTypes.length && !isOpponentTurn ? 'item-prompt-mode' : ''}`}>
    {isOpponentTurn ? <button data-testid="turn-waiting-button" className="roll-button" disabled>{activeSeatTurnText} 차례</button> : activeItemPromptTypes.length > 0 ? <div className="inline-item-prompt" role="dialog" aria-label="아이템 사용 선택">
      <div><strong>아이템을 사용할까요?</strong></div>
      <div className="time-limit-bar item-prompt-timer" style={{ '--timer-duration': `${itemPromptTimerDurationMs}ms` } as CSSProperties} aria-hidden="true"><span></span></div>
      <div className="inline-item-actions">
        {activeItemPromptTypes.map((type, index) => <button className="inline-item-button" key={`${type}-${index}`} onClick={() => runPlayerAction(() => onUseItem(type))}><span>{ITEM_DEFINITIONS[type].icon}</span>{ITEM_DEFINITIONS[type].name}</button>)}
        <button className="secondary" onClick={() => runPlayerAction(onSkipItemPrompt)}>사용 안 함</button>
      </div>
    </div> : showBottomBranchControls ? <div className="bottom-branch-controls" aria-label="이동 방향 선택">
      <button type="button" className={displayBranchChoice === 'outer' ? 'active' : ''} onClick={() => onBranchChoiceChange('outer')} disabled={turnActionTimedOut}>바깥길</button>
      <button type="button" className={displayBranchChoice === 'shortcut' ? 'active' : ''} onClick={() => onBranchChoiceChange('shortcut')} disabled={turnActionTimedOut}>지름길</button>
      {canRequestMove && <div key={turnActionDeadlineKey} className="time-limit-bar turn-action-timer" style={{ '--timer-duration': `${turnActionTimerDurationMs}ms` } as CSSProperties} aria-hidden="true"><span></span></div>}
      <button type="button" data-testid="move-piece-button" className="branch-move-button" onClick={() => runPlayerAction(onMoveSelectedPiece, timerSeatId)} disabled={turnActionTimedOut || !canRequestMove}>선택한 말 이동</button>
    </div> : <>
      {turnActionTimerVisible && <div key={turnActionDeadlineKey} className="time-limit-bar turn-action-timer" style={{ '--timer-duration': `${turnActionTimerDurationMs}ms` } as CSSProperties} aria-hidden="true"><span></span></div>}
      {showRollStackPicker && <div className="roll-stack-picker" aria-label="이동 스택 선택"><div className="roll-stack-options">{rollStack.map((entry, index) => <button type="button" key={`${entry.name}-${index}`} onClick={() => moveSelectionTimedOut ? onMoveRollStackIndex(index) : onSelectRollStackIndex(index)} disabled={turnActionTimedOut}>{entry.name}</button>)}</div></div>}
      {rollControlPresentation.showTimingMeter && !turnActionTimedOut && <div ref={rollTimingMeterRef} className="roll-timing-meter" aria-label="윷 던지기 정확도 막대"><span className="roll-timing-good left" aria-hidden="true"></span><span className="roll-timing-perfect" aria-hidden="true"></span><span className="roll-timing-good right" aria-hidden="true"></span><span ref={rollTimingOrbRef} className="roll-timing-orb" aria-hidden="true"></span></div>}
      {!showRollStackPicker && <button data-testid={rollControlPresentation.actionButtonTestId} className={!roll ? 'roll-button' : undefined} onClick={handleRollButtonClick} disabled={turnActionTimedOut || (!canRollNow && !roll) || Boolean((roll || showRollStackMoveButton) && !canRequestMove)}>{showRollStackMoveButton && !turnActionTimedOut ? '선택한 말 이동' : actionButtonText}</button>}
    </>}
  </div>;
}
