type MoveExecutionReadiness = {
  canRequestMove: boolean;
  canSubmitTurnAction: boolean;
  contextKey: string;
  baseContextKey: string;
};

type MoveActionContext = {
  contextKey: string;
  baseContextKey: string;
  stackIndex: string;
};

let latestMoveExecutionReadiness: MoveExecutionReadiness = {
  canRequestMove: false,
  canSubmitTurnAction: false,
  contextKey: '',
  baseContextKey: '',
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

function getMoveActionScopeKey(actionKey: string) {
  if (!actionKey.startsWith('move_piece:')) return '';
  return actionKey.split(':').slice(0, 4).join(':');
}

export function isMoveActionAlreadyClaimed(actionKey: string, claimedActionKeys: Set<string>) {
  const scopeKey = getMoveActionScopeKey(actionKey);
  if (!scopeKey) return false;
  return Array.from(claimedActionKeys).some((claimedActionKey) => getMoveActionScopeKey(claimedActionKey) === scopeKey);
}

function getMoveActionContext(actionKey: string): MoveActionContext {
  if (!actionKey.startsWith('move_piece:')) return { contextKey: '', baseContextKey: '', stackIndex: '' };
  const parts = actionKey.split(':');
  const stackMarkerIndex = parts.lastIndexOf('stack');
  if (stackMarkerIndex < 3) return { contextKey: '', baseContextKey: '', stackIndex: '' };
  const contextParts = parts.slice(0, stackMarkerIndex - 2);
  if (contextParts.length < 8) return { contextKey: '', baseContextKey: '', stackIndex: '' };
  return {
    contextKey: contextParts.join(':'),
    baseContextKey: [
      ...contextParts.slice(0, 4),
      contextParts[contextParts.length - 3],
      contextParts[contextParts.length - 2],
    ].join(':'),
    stackIndex: parts[stackMarkerIndex + 1] ?? '',
  };
}

function isExplicitStackMove(stackIndex: string) {
  if (!stackIndex || stackIndex === 'none') return false;
  const numericIndex = Number(stackIndex);
  return Number.isInteger(numericIndex) && numericIndex >= 0;
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
  const rollKey = roll ? `${String(roll.name ?? '')}:${String(roll.steps ?? '')}` : 'ready';
  const baseContextParts = [
    'move_piece',
    String(diagnosticState.localSeatId ?? ''),
    String(diagnosticState.lastAppliedSequence ?? ''),
    String(diagnosticState.turnIndex ?? ''),
    String(diagnosticState.lastMovedSeatId ?? ''),
    lastMovedPieceIds.join(','),
  ];
  return {
    canRequestMove: diagnosticState.canRequestMove === true,
    canSubmitTurnAction: diagnosticState.canSubmitTurnAction === true,
    contextKey: [
      ...baseContextParts.slice(0, 4),
      rollKey,
      ...baseContextParts.slice(4),
      String(activeMovablePiece?.id ?? ''),
    ].join(':'),
    baseContextKey: baseContextParts.join(':'),
  };
}

export function publishMoveExecutionReadiness(readiness: MoveExecutionReadiness) {
  latestMoveExecutionReadiness = readiness;
}

export function canExecuteMoveActionNow(actionKey: string) {
  const actionContext = getMoveActionContext(actionKey);
  if (shouldExecuteScheduledMove({
    canRequestMove: latestMoveExecutionReadiness.canRequestMove,
    scheduledContextKey: actionContext.contextKey,
    latestContextKey: latestMoveExecutionReadiness.contextKey,
  })) return true;

  return latestMoveExecutionReadiness.canSubmitTurnAction
    && isExplicitStackMove(actionContext.stackIndex)
    && Boolean(actionContext.baseContextKey)
    && actionContext.baseContextKey === latestMoveExecutionReadiness.baseContextKey;
}
