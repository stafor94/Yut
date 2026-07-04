import type { ReactNode } from 'react';

type GameScreenProps = { children: ReactNode };

export function GameScreen({ children }: GameScreenProps) {
  return <section data-testid="game-screen" className="game-layout" aria-label="게임 플레이 화면">{children}</section>;
}
