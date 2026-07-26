import { useEffect } from 'react';

export function useTurnOrderPortraitScroll(screen: string, shouldScrollForTurnOrder: boolean) {
  useEffect(() => {
    if (screen !== 'game' || !shouldScrollForTurnOrder) return undefined;
    if (!window.matchMedia('(orientation: portrait)').matches) return undefined;
    const timer = window.setTimeout(() => {
      const scrollTarget = document.querySelector<HTMLElement>('.play-controls')
        ?? document.querySelector<HTMLElement>('.board-panel');
      scrollTarget?.scrollIntoView({ behavior: 'smooth', block: 'end', inline: 'nearest' });
    }, 80);
    return () => window.clearTimeout(timer);
  }, [screen, shouldScrollForTurnOrder]);
}
