import { useEffect, useState } from 'react';

export function useDisplayClock(active: boolean, intervalMs: number, deadlineAt = 0) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    if (!active || typeof window === 'undefined') return undefined;

    const normalizedIntervalMs = Math.max(50, Math.floor(intervalMs));
    const remainingMs = deadlineAt > 0 ? deadlineAt - Date.now() : 0;
    if (deadlineAt > 0 && remainingMs <= 0) return undefined;

    const interval = window.setInterval(tick, normalizedIntervalMs);
    const deadlineTimer = deadlineAt > 0
      ? window.setTimeout(() => {
          window.clearInterval(interval);
          tick();
        }, remainingMs)
      : null;

    return () => {
      window.clearInterval(interval);
      if (deadlineTimer !== null) window.clearTimeout(deadlineTimer);
    };
  }, [active, deadlineAt, intervalMs]);

  return now;
}
