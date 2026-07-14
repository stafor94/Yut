import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import type { YutResult } from '../../game-core/roll';
import { YutRollScenePhysics } from '../components/YutRollScenePhysics';
import type { RollAnimation, ToastMessage } from '../appState';

type WinnerOverlayProps = {
  winner: string;
  winnerText: ReactNode;
  canContinueRace: boolean;
  onReturnToWaitingRoom: () => void;
  onExitToLobby: () => void;
  onContinueRace: () => void;
};

export function WinnerOverlay({ winner, winnerText, canContinueRace, onReturnToWaitingRoom, onExitToLobby, onContinueRace }: WinnerOverlayProps) {
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
    <p>원하는 다음 행동을 선택하세요.</p>
    <button onClick={onReturnToWaitingRoom}>대기실로 돌아가기</button>
    {canContinueRace && <button data-testid="continue-race-button" onClick={onContinueRace}>이어서 진행하기</button>}
    <button className="secondary" onClick={onExitToLobby}>로비로 나가기</button>
  </div>;
}

type GoldenYutPickerProps = {
  isOpen: boolean;
  choices: YutResult[];
  onSelect: (choice: YutResult) => void;
};

export function GoldenYutPicker({ isOpen, choices, onSelect }: GoldenYutPickerProps) {
  if (!isOpen) return null;
  return <div className="golden-yut-picker" role="dialog" aria-modal="true" aria-label="황금 윷 결과 선택">
    <h2>황금 윷 결과 선택</h2>
    <p>원하는 결과를 고르면 다음 윷 던지기가 반드시 그 결과로 나옵니다.</p>
    <div>{choices.map((choice) => <button key={choice.name} onClick={() => onSelect(choice)}>{choice.name}</button>)}</div>
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

export function TurnIndicator({ color, showNeighbors, previousText, previousColor, currentText, currentRollStack, nextText, nextColor }: TurnIndicatorProps) {
  return <div data-testid="turn-indicator" className="turn-indicator">
    {showNeighbors && <span className="turn-neighbor previous-turn" style={{ color: previousColor }}>{previousText}</span>}
    {showNeighbors && <span className="turn-separator" aria-hidden="true">&gt;</span>}
    <strong className="turn-current" style={{ '--turn-current-color': color } as CSSProperties}>
      <span className="turn-current-badge">{currentText}</span>
      {currentRollStack.length > 0 && <span className="turn-roll-stack-badges" aria-label={`남은 이동 스택: ${currentRollStack.map((entry) => entry.name).join(', ')}`}>{currentRollStack.map((entry, index) => <span key={`${entry.name}-${index}`} className="turn-roll-stack-badge">{entry.name}</span>)}</span>}
    </strong>
    {showNeighbors && <span className="turn-separator" aria-hidden="true">&gt;</span>}
    {showNeighbors && <span className="turn-neighbor next-turn" style={{ color: nextColor }}>{nextText}</span>}
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
};

export function RollStage({ rollAnimation }: RollStageProps) {
  const [settledAnimationId, setSettledAnimationId] = useState<number | null>(null);
  if (!rollAnimation) return null;
  const isPreResult = rollAnimation.phase === 'primary' || rollAnimation.phase === 'extra-spin';
  const isLanding = rollAnimation.phase === 'landing';
  const isResultHold = rollAnimation.phase === 'result-hold';
  const result = 'result' in rollAnimation ? rollAnimation.result : undefined;
  const fallCount = 'fallCount' in rollAnimation ? rollAnimation.fallCount ?? 0 : 0;
  const turnOrder = 'turnOrder' in rollAnimation ? rollAnimation.turnOrder : false;
  const hasSettled = settledAnimationId === rollAnimation.id;
  const isVisualLanding = isLanding || (isResultHold && !hasSettled);
  const shouldShowResult = Boolean(result) && hasSettled && !isPreResult && !isLanding;
  const hasResolvedResult = (isLanding || isResultHold || Boolean(result)) && Boolean(result);
  const isBonusResult = hasResolvedResult && !turnOrder && !fallCount && (result?.name === '윷' || result?.name === '모');
  const phaseClass = isPreResult ? `pending-roll ${rollAnimation.phase === 'extra-spin' ? 'extra-spin-roll' : 'primary-roll'}` : isVisualLanding ? 'resolved-from-pending resolved-roll landing-roll' : isResultHold ? 'resolved-from-pending resolved-roll result-hold-roll' : 'resolved-roll';
  return <div className={`roll-stage ${phaseClass}`} role="status" aria-live="polite">
    <div className="roll-aura" aria-hidden="true"></div>
    <div className="roll-impact-burst" aria-hidden="true">{Array.from({ length: 10 }, (_, index) => <span key={`spark-${rollAnimation.id}-${index}`} style={{ '--spark-index': index } as CSSProperties}></span>)}</div>
    <div data-testid="roll-mat" className={`roll-mat ${isBonusResult ? 'bonus-roll' : ''} ${hasResolvedResult && fallCount ? 'fall-roll' : ''}`}>
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
      {rollAnimation.timingZone && <span className={`roll-timing-feedback roll-stage-timing ${rollAnimation.timingZone}`}>{rollAnimation.timingZone === 'perfect' ? 'Perfect!' : rollAnimation.timingZone === 'good' ? 'Good!' : 'Normal'}</span>}
      {hasResolvedResult && result && <span className={shouldShowResult ? 'roll-label' : 'roll-label-placeholder'} hidden={!shouldShowResult} aria-hidden={!shouldShowResult}>{fallCount ? '낙!' : result.name}</span>}
      <YutRollScenePhysics rollAnimation={rollAnimation} onSettled={() => setSettledAnimationId(rollAnimation.id)} />
    </div>
  </div>;
}
