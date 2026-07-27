import { Children, isValidElement, useSyncExternalStore, type ReactElement, type ReactNode } from 'react';
import { getRoomInfoCollapsed, subscribeRoomInfoPresentation } from '../flows/roomInfoPresentation';

type GameScreenProps = { children: ReactNode };
type GamePanelProps = { children: ReactNode };
type AutoPlayOverlayProps = {
  children?: ReactNode;
  'data-testid'?: string;
};
type BoardControlsProps = {
  autoPlayActive?: boolean;
  onRollYut?: unknown;
};

function isAutoPlayOverlay(child: ReactNode): child is ReactElement<AutoPlayOverlayProps> {
  return isValidElement<AutoPlayOverlayProps>(child) && child.props['data-testid'] === 'auto-play-overlay';
}

function isBoardControls(child: ReactNode): child is ReactElement<BoardControlsProps> {
  return isValidElement<BoardControlsProps>(child)
    && typeof child.type !== 'string'
    && 'autoPlayActive' in child.props
    && 'onRollYut' in child.props;
}

export function GameScreen({ children }: GameScreenProps) {
  const roomInfoCollapsed = useSyncExternalStore(subscribeRoomInfoPresentation, getRoomInfoCollapsed, getRoomInfoCollapsed);

  return <section
    data-testid="game-screen"
    data-room-info-collapsed={roomInfoCollapsed ? 'true' : 'false'}
    className={`game-layout ${roomInfoCollapsed ? 'room-info-collapsed' : 'room-info-expanded'}`}
    aria-label="게임 플레이 화면"
  >{children}</section>;
}

export function PlayersPanel({ children }: GamePanelProps) {
  return <aside data-testid="players-panel" className="panel players game-players-panel">{children}</aside>;
}

export function BoardPanel({ children }: GamePanelProps) {
  const childList = Children.toArray(children);
  const autoPlayOverlay = childList.find(isAutoPlayOverlay);

  return <section className="panel board-panel">{childList.map((child) => {
    if (child === autoPlayOverlay) return null;
    if (autoPlayOverlay && isBoardControls(child)) {
      return <div
        key="auto-play-controls"
        data-testid="play-controls"
        className="play-controls auto-play-mode"
        role="region"
        aria-label="AI 자동 플레이 조작 상태"
      >
        <div
          data-testid="auto-play-control-panel"
          className="auto-play-control-panel"
          role="status"
          aria-live="polite"
        >{autoPlayOverlay.props.children}</div>
      </div>;
    }
    return child;
  })}</section>;
}

export function GameLogPanel({ children }: GamePanelProps) {
  return <aside className="panel side">{children}</aside>;
}
