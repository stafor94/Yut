type MoveExecutionReadiness = {
  canRequestMove: boolean;
  contextKey: string;
};

let latestMoveExecutionReadiness: MoveExecutionReadiness = {
  canRequestMove: false,
  contextKey: '',
};

export function shouldExecuteScheduledMove({
  canRequestMove,
  scheduledContextKey,
  latestContextKey,
}: {
  canRequestMove: boolean;
  scheduledContextKey: string;
  latestContextKey: string;
}) {
  return canRequestMove
    && Boolean(scheduledContextKey)
    && scheduledContextKey === latestContextKey;
}

export function isMoveActionAlreadyClaimed(actionKey: string, claimedActionKeys: Set<string>) {
  return actionKey.startsWith('move_piece:') && claimedActionKeys.has(actionKey);
}

function getMoveActionContextKey(actionKey: string) {
  if (!actionKey.startsWith('move_piece:')) return '';
  return actionKey.split(':').slice(1, 9).join(':');
}

export function getMoveExecutionReadinessFromDiagnosticState(diagnosticState: Record<string, unknown>): MoveExecutionReadiness {
  const roll = diagnosticState.roll && typeof diagnosticState.roll === 'object'
    ? diagnosticState.roll as { name?: unknown; steps?: unknown }
    : null;
  const activeMovablePiece = diagnosticState.activeMovablePiece && typeof diagnosticState.activeMovablePiece === 'object'
    ? diagnosticState.activeMovablePiece as { id?: unknown }
    : null;
  const lastMovedPieceIds = Array.isArray(diagnosticState.lastMovedPieceIds)
    ? diagnosticState.lastMovedPieceIds.map(String)
    : [];
  const contextKey = [
    String(diagnosticState.localSeatId ?? ''),
    String(diagnosticState.lastAppliedSequence ?? ''),
    String(diagnosticState.turnIndex ?? ''),
    String(roll?.name ?? ''),
    String(roll?.steps ?? ''),
    String(diagnosticState.lastMovedSeatId ?? ''),
    lastMovedPieceIds.join(','),
    String(activeMovablePiece?.id ?? ''),
  ].join(':');
  return {
    canRequestMove: diagnosticState.canRequestMove === true,
    contextKey,
  };
}

export function publishMoveExecutionReadiness(readiness: MoveExecutionReadiness) {
  latestMoveExecutionReadiness = readiness;
}

export function canExecuteMoveActionNow(actionKey: string) {
  return shouldExecuteScheduledMove({
    canRequestMove: latestMoveExecutionReadiness.canRequestMove,
    scheduledContextKey: getMoveActionContextKey(actionKey),
    latestContextKey: latestMoveExecutionReadiness.contextKey,
  });
}
