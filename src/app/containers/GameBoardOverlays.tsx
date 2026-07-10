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
    phase?: 'pending' | 'resolved' | 'resolved-from-pending';
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
  const isPending = rollAnimation.phase === 'pending';
  const isResolvedFromPending = rollAnimation.phase === 'resolved-from-pending';
  return <div className={`roll-stage ${isPending ? 'pending-roll' : isResolvedFromPending ? 'resolved-from-pending resolved-roll' : 'resolved-roll'}`} role="status" aria-live="polite">
    <div className="roll-aura" aria-hidden="true"></div>
    <div className="roll-impact-burst" aria-hidden="true">{Array.from({ length: 10 }, (_, index) => <span key={`spark-${rollAnimation.id}-${index}`} style={{ '--spark-index': index } as CSSProperties}></span>)}</div>
    <div className={`roll-mat ${!isPending && rollAnimation.result?.bonus && !rollAnimation.turnOrder ? 'bonus-roll' : ''} ${!isPending && rollAnimation.fallCount ? 'fall-roll' : ''}`}>
      {!isPending && rollAnimation.timingZone && <span className={`roll-timing-feedback roll-stage-timing ${rollAnimation.timingZone}`}>{rollAnimation.timingZone === 'perfect' ? 'Perfect!' : rollAnimation.timingZone === 'good' ? 'Good!' : 'Normal'}</span>}
      {!isPending && rollAnimation.result && <span className="roll-label">{rollAnimation.fallCount ? '낙!' : rollAnimation.result.name}</span>}
      {rollAnimation.sticks.map((stick, index) => {
        const markCount = isPending ? 0 : stick.flat ? stick.marked ? 1 : 0 : 3;
        const isFallenStick = Boolean(!isPending && rollAnimation.fallCount && index < rollAnimation.fallCount);
        return <span key={`${rollAnimation.id}-${index}`} className={`yut-stick ${stick.flat ? 'flat' : 'round'} ${stick.marked ? 'marked' : ''} ${isFallenStick ? 'fallen' : ''}`} style={{ '--stick-index': index, '--stick-start-rotate': `${-360 + index * 45}deg`, '--stick-land-rotate': `${28 - index * 14}deg`, '--stick-bounce-rotate': `${12 + index * 18}deg`, '--stick-final-rotate': `${-8 + index * 12}deg`, '--fall-x': `${index % 2 === 0 ? -118 - index * 10 : 118 + index * 8}px`, '--fall-y': `${index < 2 ? -34 + index * 22 : 78 - index * 8}px`, '--fall-rotate': `${index % 2 === 0 ? -64 - index * 18 : 62 + index * 16}deg` } as CSSProperties}><i>{Array.from({ length: markCount }, (_, markIndex) => <span key={`mark-${rollAnimation.id}-${index}-${markIndex}`} className="yut-mark" aria-hidden="true"></span>)}</i></span>;
      })}
    </div>
  </div>;
}
