import { useEffect, useState } from 'react';

const TURN_ORDER_INTRO_HEARTBEAT_MS = 250;

export function useTurnOrderPortraitScroll(screen: string, shouldScrollForTurnOrder: boolean) {
  const [, setHeartbeatAt] = useState(0);

  useEffect(() => {
    if (screen !== 'game' || !shouldScrollForTurnOrder) return undefined;

    // Keep absolute-time turn-order deadlines observable even when a browser delays
    // the one-shot completion timer. The heartbeat is active only during the bounded
    // turn-order presentation and does not extend any deadline.
    const heartbeatTimer = window.setInterval(() => setHeartbeatAt(Date.now()), TURN_ORDER_INTRO_HEARTBEAT_MS);
    let scrollTimer: number | null = null;
    if (window.matchMedia('(orientation: portrait)').matches) {
      scrollTimer = window.setTimeout(() => {
        const scrollTarget = document.querySelector<HTMLElement>('.play-controls')
          ?? document.querySelector<HTMLElement>('.board-panel');
        scrollTarget?.scrollIntoView({ behavior: 'smooth', block: 'end', inline: 'nearest' });
      }, 80);
    }

    return () => {
      window.clearInterval(heartbeatTimer);
      if (scrollTimer !== null) window.clearTimeout(scrollTimer);
    };
  }, [screen, shouldScrollForTurnOrder]);
}
