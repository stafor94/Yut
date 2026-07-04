import { useEffect } from 'react';

export function useGameSyncDebugState(diagnosticState: Record<string, unknown>) {
  useEffect(() => {
    (window as typeof window & { __YUT_DEBUG_STATE__?: Record<string, unknown> }).__YUT_DEBUG_STATE__ = diagnosticState;
  }, [diagnosticState]);
}
