import type { CSSProperties, ReactNode } from 'react';
import type { RollTimingZone, YutResult } from '../../game-core/roll';
import type { ToastMessage } from '../appState';

type WinnerOverlayProps = {
  winner: string;
  winnerText: ReactNode;
  canContinueRace: boolean;
  onReturnToWaitingRoom: () => void;
  onExitToLobby: () => void;
  onContinueRace: () => void;
};

export function WinnerOverlay({ winner, winnerText, canContinueRace, onReturnToWaitingRoom, onExitToLobby, onContinueRace }: WinnerOverlayProps) {
  if (!winner) return null;
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
  return <div data-testid="turn-indicator" className="turn-indicator" style={{ color }}>
    {showNeighbors && <span className="turn-neighbor previous-turn" style={{ color: previousColor }}>{previousText}</span>}
    {showNeighbors && <span className="turn-separator" aria-hidden="true">&gt;</span>}
    <strong className="turn-current"><span>{currentText}</span>{currentRollStack.length > 0 && <span className="turn-roll-stack-badges" aria-label={`남은 이동 스택: ${currentRollStack.map((entry) => entry.name).join(', ')}`}>{currentRollStack.map((entry, index) => <span key={`${entry.name}-${index}`} className="turn-roll-stack-badge">{entry.name}</span>)}</span>}</strong>
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
  rollAnimation: {
    id: number;
    phase?: 'primary' | 'extra-spin' | 'landing' | 'result-hold' | 'resolved';
    actionKey?: string;
    result?: YutResult;
    sticks: { flat: boolean; marked?: boolean }[];
    turnOrder?: boolean;
    fallCount?: number;
    timingZone?: RollTimingZone;
  } | null;
};

export function RollStage({ rollAnimation }: RollStageProps) {
  if (!rollAnimation) return null;
  const isPreResult = rollAnimation.phase === 'primary' || rollAnimation.phase === 'extra-spin';
  const isLanding = rollAnimation.phase === 'landing';
  const isResultHold = rollAnimation.phase === 'result-hold';
  const result = rollAnimation.result;
  const shouldShowResult = !isPreResult && !isLanding && Boolean(result);
  const isBonusResult = shouldShowResult && !rollAnimation.turnOrder && !rollAnimation.fallCount && (result?.name === '윷' || result?.name === '모');
  const phaseClass = isPreResult ? `pending-roll ${rollAnimation.phase === 'extra-spin' ? 'extra-spin-roll' : 'primary-roll'}` : isLanding || isResultHold ? `resolved-from-pending resolved-roll ${isLanding ? 'landing-roll' : 'result-hold-roll'}` : 'resolved-roll';
  return <div className={`roll-stage ${phaseClass}`} role="status" aria-live="polite">
    <div className="roll-aura" aria-hidden="true"></div>
    <div className="roll-impact-burst" aria-hidden="true">{Array.from({ length: 10 }, (_, index) => <span key={`spark-${rollAnimation.id}-${index}`} style={{ '--spark-index': index } as CSSProperties}></span>)}</div>
    <div className={`roll-mat ${isBonusResult ? 'bonus-roll' : ''} ${shouldShowResult && rollAnimation.fallCount ? 'fall-roll' : ''}`}>
      {rollAnimation.timingZone && <span className={`roll-timing-feedback roll-stage-timing ${rollAnimation.timingZone}`}>{rollAnimation.timingZone === 'perfect' ? 'Perfect!' : rollAnimation.timingZone === 'good' ? 'Good!' : 'Normal'}</span>}
      {shouldShowResult && result && <span className="roll-label">{rollAnimation.fallCount ? '낙!' : result.name}</span>}
      {rollAnimation.sticks.map((stick, index) => {
        const flatMarkCount = isPreResult ? 0 : stick.flat && stick.marked ? 1 : 0;
        const roundMarkCount = isPreResult ? 0 : stick.flat ? 0 : 3;
        const isFallenStick = Boolean(!isPreResult && rollAnimation.fallCount && index < rollAnimation.fallCount);
        const faceClassName = isPreResult ? '' : stick.flat ? 'flat' : 'round';
        return <span key={`${rollAnimation.id}-${index}`} className={`yut-stick ${faceClassName} ${stick.marked ? 'marked' : ''} ${isFallenStick ? 'fallen' : ''}`} style={{ '--stick-index': index, '--stick-start-rotate': `${-360 + index * 45}deg`, '--stick-land-rotate': `${28 - index * 14}deg`, '--stick-bounce-rotate': `${12 + index * 18}deg`, '--stick-final-rotate': `${-8 + index * 12}deg`, '--fall-x': `${index % 2 === 0 ? -118 - index * 10 : 118 + index * 8}px`, '--fall-y': `${index < 2 ? -34 + index * 22 : 78 - index * 8}px`, '--fall-rotate': `${index % 2 === 0 ? -64 - index * 18 : 62 + index * 16}deg` } as CSSProperties}>
          <span className="yut-stick-body" aria-hidden="true">
            <i className="yut-stick-flat-face">{Array.from({ length: flatMarkCount }, (_, markIndex) => <span key={`flat-mark-${rollAnimation.id}-${index}-${markIndex}`} className="yut-mark" aria-hidden="true"></span>)}</i>
            <i className="yut-stick-round-face">{Array.from({ length: roundMarkCount }, (_, markIndex) => <span key={`round-mark-${rollAnimation.id}-${index}-${markIndex}`} className="yut-mark" aria-hidden="true"></span>)}</i>
          </span>
        </span>;
      })}
    </div>
  </div>;
}
