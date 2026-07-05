import { useRef, type CSSProperties } from 'react';
import { ITEM_DEFINITIONS, type ItemType } from '../../features/items/logic/items';
import type { BranchChoice } from '../../game-core/board/board';
import type { RollTimingZone, YutResult } from '../../game-core/roll';

type GameBoardControlsProps = {
  roll: YutResult | null;
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
  rollTimingFeedback: RollTimingZone | null;
  rollResultHolding: boolean;
  pendingTrapPlacement: boolean;
  waitingForOnlineTurnOrder: boolean;
  hasActiveTurnOrderIntro: boolean;
};

export function GameBoardControls({
  roll,
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
  rollTimingFeedback,
  rollResultHolding,
  pendingTrapPlacement,
  waitingForOnlineTurnOrder,
  hasActiveTurnOrderIntro,
}: GameBoardControlsProps) {
  const rollTimingMeterRef = useRef<HTMLDivElement | null>(null);
  const rollTimingOrbRef = useRef<HTMLSpanElement | null>(null);
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
  const handleRollButtonClick = () => {
    if (roll) {
      onMoveSelectedPiece();
      return;
    }
    onRollYut(getVisibleRollTimingPositionPercent());
  };
  const timerDurationMs = activeSeatId ? getTurnActionTimeoutMs(activeSeatId) : turnActionTimeoutMs;
  const buttonText = roll
    ? (rollResultHolding ? '결과 확인 중...' : '선택한 말 이동')
    : activeSeatId && activeSeatId !== localSeatId ? `${activeSeatTurnText} 차례`
      : pendingTrapPlacement ? '함정 설치 대기 중'
        : waitingForOnlineTurnOrder ? '순서 정하기 대기 중'
          : hasActiveTurnOrderIntro ? '결과 확인 중' : '윷 던지기';

  return <div className={`play-controls ${!roll ? 'roll-ready' : ''} ${showBottomBranchControls ? 'branch-choice-mode' : ''} ${activeItemPromptTypes.length ? 'item-prompt-mode' : ''}`}>
    {activeItemPromptTypes.length > 0 ? <div className="inline-item-prompt" role="dialog" aria-label="아이템 사용 선택">
      <div><strong>아이템을 사용할까요?</strong></div>
      <div className="time-limit-bar item-prompt-timer" style={{ '--timer-duration': `${getItemPromptTimeoutMs(localSeatId)}ms` } as CSSProperties} aria-hidden="true"><span></span></div>
      <div className="inline-item-actions">
        {activeItemPromptTypes.map((type, index) => <button className="inline-item-button" key={`${type}-${index}`} onClick={() => onUseItem(type)}><span>{ITEM_DEFINITIONS[type].icon}</span>{ITEM_DEFINITIONS[type].name}</button>)}
        <button className="secondary" onClick={onSkipItemPrompt}>사용 안 함</button>
      </div>
    </div> : showBottomBranchControls ? <div className="bottom-branch-controls" aria-label="이동 방향 선택">
      <button type="button" className={displayBranchChoice === 'outer' ? 'active' : ''} onClick={() => onBranchChoiceChange('outer')}>바깥길</button>
      <button type="button" className={displayBranchChoice === 'shortcut' ? 'active' : ''} onClick={() => onBranchChoiceChange('shortcut')}>지름길</button>
      {canRequestMove && <div className="time-limit-bar turn-action-timer" style={{ '--timer-duration': `${timerDurationMs}ms` } as CSSProperties} aria-hidden="true"><span></span></div>}
      <button type="button" className="branch-move-button" onClick={onMoveSelectedPiece} disabled={!canRequestMove}>선택한 말 이동</button>
    </div> : <>
      {((!roll && canRollNow) || (roll && canRequestMove)) && <div className="time-limit-bar turn-action-timer" style={{ '--timer-duration': `${timerDurationMs}ms` } as CSSProperties} aria-hidden="true"><span></span></div>}
      {rollTimingFeedback && <div className={`roll-timing-feedback ${rollTimingFeedback}`}>{rollTimingFeedback === 'perfect' ? 'Perfect!' : rollTimingFeedback === 'good' ? 'Good!' : 'Normal'}</div>}
      {!roll && canRollNow && <div ref={rollTimingMeterRef} className="roll-timing-meter" aria-label="윷 던지기 정확도 막대"><span className="roll-timing-good left" aria-hidden="true"></span><span className="roll-timing-perfect" aria-hidden="true"></span><span className="roll-timing-good right" aria-hidden="true"></span><span ref={rollTimingOrbRef} className="roll-timing-orb" aria-hidden="true"></span></div>}
      <button data-testid={roll ? 'move-piece-button' : canSubmitTurnAction ? 'roll-yut-button' : 'turn-waiting-button'} className={!roll ? 'roll-button' : undefined} onClick={handleRollButtonClick} disabled={(!canRollNow && !roll) || Boolean(roll && !canRequestMove)}>{buttonText}</button>
    </>}
  </div>;
}
