import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { YutResult } from '../../game-core/roll';
import {
  dismissGoldenYutPicker,
  EMPTY_GOLDEN_YUT_PICKER_PRESENTATION_STATE,
  markGoldenYutRollPresentationCompleted,
  shouldShowGoldenYutPicker,
  syncGoldenYutPickerOpenState,
} from '../flows/goldenYutPickerPresentation';
import {
  getFallPresentationActive,
  subscribeFallPresentationActive,
  subscribeRollPresentationCompleted,
} from '../flows/rollPresentationEvents';
import type { ToastMessage } from '../appState';

export { RollStage } from './RollStage';
export type { RollPresentationState } from '../flows/rollPresentationVisibility';

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
  const [keepNeighborsVisible, setKeepNeighborsVisible] = useState(getFallPresentationActive);

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
