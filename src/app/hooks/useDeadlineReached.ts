import { useEffect, useState } from 'react';

export function useDeadlineReached(deadlineAt: number) {
  const [reachedDeadlineAt, setReachedDeadlineAt] = useState(0);

  useEffect(() => {
    if (!deadlineAt || typeof window === 'undefined') return undefined;
    const markReached = () => setReachedDeadlineAt(deadlineAt);
    const remainingMs = deadlineAt - Date.now();
    if (remainingMs <= 0) {
      markReached();
      return undefined;
    }
    const timer = window.setTimeout(markReached, remainingMs);
    return () => window.clearTimeout(timer);
  }, [deadlineAt]);

  return Boolean(deadlineAt && reachedDeadlineAt === deadlineAt);
}
