import type { CSSProperties, ReactNode } from 'react';
import type { YutResult } from '../../game-core/roll';
import type { ToastMessage } from '../appState';

type WinnerOverlayProps = {
  winner: string;
  winnerText: ReactNode;
  canContinueRace: boolean;
  onFinishGame: () => void;
  onContinueRace: () => void;
};

export function WinnerOverlay({ winner, winnerText, canContinueRace, onFinishGame, onContinueRace }: WinnerOverlayProps) {
  if (!winner) return null;
  return <div data-testid="winner-overlay" className="winner-overlay" role="status" aria-live="assertive">
    <span>게임 종료</span>
    <strong>{winnerText}</strong>
    <p>아래 버튼으로 대기화면에 돌아갈 수 있습니다.</p>
    <button onClick={onFinishGame}>대기화면으로</button>
    {canContinueRace && <button data-testid="continue-race-button" onClick={onContinueRace}>이어서 진행</button>}
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
  currentText: ReactNode;
  nextText: ReactNode;
};

export function TurnIndicator({ color, showNeighbors, previousText, currentText, nextText }: TurnIndicatorProps) {
  return <div data-testid="turn-indicator" className="turn-indicator" style={{ color }}>
    {showNeighbors && <span className="turn-neighbor previous-turn">{previousText}</span>}
    {showNeighbors && <span className="turn-separator" aria-hidden="true">&gt;</span>}
    <strong>{currentText}</strong>
    {showNeighbors && <span className="turn-separator" aria-hidden="true">&gt;</span>}
    {showNeighbors && <span className="turn-neighbor next-turn">{nextText}</span>}
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
    result: YutResult;
    sticks: { flat: boolean; marked?: boolean }[];
    turnOrder?: boolean;
  } | null;
};

export function RollStage({ rollAnimation }: RollStageProps) {
  if (!rollAnimation) return null;
  return <div className="roll-stage" role="status" aria-live="polite">
    <div className="roll-aura" aria-hidden="true"></div>
    <div className="roll-impact-burst" aria-hidden="true">{Array.from({ length: 10 }, (_, index) => <span key={`spark-${rollAnimation.id}-${index}`} style={{ '--spark-index': index } as CSSProperties}></span>)}</div>
    <div className={`roll-mat ${rollAnimation.result.bonus && !rollAnimation.turnOrder ? 'bonus-roll' : ''}`}>
      <span className="roll-label">{rollAnimation.result.name}</span>
      {rollAnimation.sticks.map((stick, index) => {
        const markCount = stick.flat ? stick.marked ? 1 : 0 : 3;
        return <span key={`${rollAnimation.id}-${index}`} className={`yut-stick ${stick.flat ? 'flat' : 'round'} ${stick.marked ? 'marked' : ''}`} style={{ '--stick-index': index, '--stick-start-rotate': `${-360 + index * 45}deg`, '--stick-land-rotate': `${28 - index * 14}deg`, '--stick-bounce-rotate': `${12 + index * 18}deg`, '--stick-final-rotate': `${-8 + index * 12}deg` } as CSSProperties}><i>{Array.from({ length: markCount }, (_, markIndex) => <span key={`mark-${rollAnimation.id}-${index}-${markIndex}`} className="yut-mark" aria-hidden="true"></span>)}</i></span>;
      })}
    </div>
  </div>;
}
