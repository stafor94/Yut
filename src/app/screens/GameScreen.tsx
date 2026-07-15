import { useSyncExternalStore, type ReactNode } from 'react';
import { getRoomInfoCollapsed, subscribeRoomInfoPresentation } from '../flows/roomInfoPresentation';

type GameScreenProps = { children: ReactNode };
type GamePanelProps = { children: ReactNode };

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
  return <section className="panel board-panel">{children}</section>;
}

export function GameLogPanel({ children }: GamePanelProps) {
  return <aside className="panel side">{children}</aside>;
}
