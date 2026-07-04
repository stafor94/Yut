import type { ReactNode } from 'react';

type GameScreenProps = { children: ReactNode };
type GamePanelProps = { children: ReactNode };

export function GameScreen({ children }: GameScreenProps) {
  return <section data-testid="game-screen" className="game-layout" aria-label="게임 플레이 화면">{children}</section>;
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
