export type MoveExecutionReadiness = {
  canRequestMove: boolean;
  canSubmitTurnAction: boolean;
  contextKey: string;
  baseContextKey: string;
  opportunityKey: string;
  hasMoveOpportunity: boolean;
};

export type MoveTransitionReadiness = {
  actionReady: boolean;
  contextKey: string;
};

type MoveActionContext = {
  contextKey: string;
  baseContextKey: string;
  opportunityKey: string;
  stackIndex: string;
};

type MoveActionClaim = {
  actionKey: string;
  opportunityKey: string;
  baseOpportunityKey: string;
  settled: boolean;
};

let latestMoveExecutionReadiness: MoveExecutionReadiness = {
  canRequestMove: false,
  canSubmitTurnAction: false,
  contextKey: '',
  baseContextKey: '',
  opportunityKey: '',
  hasMoveOpportunity: false,
};

let latestMoveTransitionReadiness: MoveTransitionReadiness = {
  actionReady: true,
  contextKey: '',
};

const moveActionClaims = new Map<string, MoveActionClaim>();

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

function normalizeRollStack(value: unknown) {
  if (!Array.isArray(value)) return '';
  return value.map((entry) => {
    if (!entry || typeof entry !== 'object') return '';
    const roll = entry as { name?: unknown; steps?: unknown };
    return `${String(roll.name ?? '')}:${String(roll.steps ?? '')}`;
  }).join(',');
}

function getMoveActionContext(actionKey: string): MoveActionContext {
  if (!actionKey.startsWith('move_piece:')) {
    return { contextKey: '', baseContextKey: '', opportunityKey: '', stackIndex: '' };
  }
  const parts = actionKey.split(':');
  const stackMarkerIndex = parts.lastIndexOf('stack');
  if (stackMarkerIndex !== 11 || parts.length < 13) {
    return { contextKey: '', baseContextKey: '', opportunityKey: '', stackIndex: '' };
  }
  const actorId = parts[1] ?? '';
  const turnIndex = parts[3] ?? '';
  const rollName = parts[4] ?? '';
  const rollSteps = parts[5] ?? '';
  const lastMovedSeatId = parts[6] ?? '';
  const lastMovedPieceIds = parts[7] ?? '';
  const pieceId = parts[8] ?? '';
  const stackIndex = parts[12] ?? 'none';
  return {
    contextKey: [
      'move_piece', actorId, turnIndex, rollName, rollSteps,
      lastMovedSeatId, lastMovedPieceIds, pieceId,
    ].join(':'),
    baseContextKey: [
      'move_piece', actorId, turnIndex, lastMovedSeatId, lastMovedPieceIds,
    ].join(':'),
    opportunityKey: [actorId, turnIndex, rollName, rollSteps, 'stack', stackIndex].join(':'),
    stackIndex,
  };
}

function getClaimKey(actionContext: MoveActionContext) {
  if (!actionContext.opportunityKey || !latestMoveExecutionReadiness.opportunityKey) return '';
  return `${latestMoveExecutionReadiness.opportunityKey}:${actionContext.opportunityKey}`;
}

function cleanupSettledMoveActionClaims() {
  for (const [claimKey, claim] of moveActionClaims) {
    if (!claim.settled) continue;
    if (!latestMoveExecutionReadiness.hasMoveOpportunity
      || claim.baseOpportunityKey !== latestMoveExecutionReadiness.opportunityKey) {
      moveActionClaims.delete(claimKey);
    }
  }
}

function isExplicitStackMove(stackIndex: string) {
  if (!stackIndex || stackIndex === 'none') return false;
  const numericIndex = Number(stackIndex);
  return Number.isInteger(numericIndex) && numericIndex >= 0;
}

export function getUnifiedMoveActionReady({
  canRequestMove,
  transitionActionReady,
}: {
  canRequestMove: boolean;
  transitionActionReady: boolean;
}) {
  return canRequestMove && transitionActionReady;
}

export function getMoveExecutionReadinessFromDiagnosticState(
  diagnosticState: Record<string, unknown>,
): MoveExecutionReadiness {
  const roll = diagnosticState.roll && typeof diagnosticState.roll === 'object'
    ? diagnosticState.roll as { name?: unknown; steps?: unknown }
    : null;
  const activeMovablePiece = diagnosticState.activeMovablePiece && typeof diagnosticState.activeMovablePiece === 'object'
    ? diagnosticState.activeMovablePiece as { id?: unknown }
    : null;
  const lastMovedPieceIds = Array.isArray(diagnosticState.lastMovedPieceIds)
    ? diagnosticState.lastMovedPieceIds.map(String)
    : [];
  const actorId = String(diagnosticState.localSeatId ?? '');
  const turnIndex = String(diagnosticState.turnIndex ?? '');
  const rollName = roll ? String(roll.name ?? '') : 'ready';
  const rollSteps = roll ? String(roll.steps ?? '') : '';
  const lastMovedSeatId = String(diagnosticState.lastMovedSeatId ?? '');
  const rollStackKey = normalizeRollStack(diagnosticState.rollStack);
  const selectedRollStackIndex = typeof diagnosticState.selectedRollStackIndex === 'number'
    ? String(diagnosticState.selectedRollStackIndex)
    : 'none';
  const baseContextParts = [
    'move_piece', actorId, turnIndex, lastMovedSeatId, lastMovedPieceIds.join(','),
  ];
  const opportunityKey = [
    actorId,
    turnIndex,
    rollName,
    rollSteps,
    lastMovedSeatId,
    lastMovedPieceIds.join(','),
    String(diagnosticState.turnDeadlineKind ?? ''),
    String(diagnosticState.turnDeadlineAt ?? ''),
    String(diagnosticState.rollResultReadyAt ?? ''),
    rollStackKey,
    selectedRollStackIndex,
  ].join(':');
  return {
    canRequestMove: diagnosticState.canRequestMove === true,
    canSubmitTurnAction: diagnosticState.canSubmitTurnAction === true,
    contextKey: [
      'move_piece', actorId, turnIndex, rollName, rollSteps,
      lastMovedSeatId, lastMovedPieceIds.join(','), String(activeMovablePiece?.id ?? ''),
    ].join(':'),
    baseContextKey: baseContextParts.join(':'),
    opportunityKey,
    hasMoveOpportunity: Boolean(actorId && roll && activeMovablePiece?.id),
  };
}

export function publishMoveExecutionReadiness(readiness: MoveExecutionReadiness) {
  latestMoveExecutionReadiness = readiness;
  cleanupSettledMoveActionClaims();
}

export function publishMoveTransitionReadiness(readiness: MoveTransitionReadiness) {
  latestMoveTransitionReadiness = readiness;
}

export function canExecuteMoveActionNow(actionKey: string) {
  const actionContext = getMoveActionContext(actionKey);
  const actionReady = getUnifiedMoveActionReady({
    canRequestMove: latestMoveExecutionReadiness.canRequestMove,
    transitionActionReady: latestMoveTransitionReadiness.actionReady,
  });
  if (shouldExecuteScheduledMove({
    canRequestMove: actionReady,
    scheduledContextKey: actionContext.contextKey,
    latestContextKey: latestMoveExecutionReadiness.contextKey,
  })) return true;

  return latestMoveTransitionReadiness.actionReady
    && latestMoveExecutionReadiness.canSubmitTurnAction
    && isExplicitStackMove(actionContext.stackIndex)
    && Boolean(actionContext.baseContextKey)
    && actionContext.baseContextKey === latestMoveExecutionReadiness.baseContextKey;
}

export function canExecuteScheduledMoveNow(scheduledContextKey: string) {
  return shouldExecuteScheduledMove({
    canRequestMove: getUnifiedMoveActionReady({
      canRequestMove: latestMoveExecutionReadiness.canRequestMove,
      transitionActionReady: latestMoveTransitionReadiness.actionReady,
    }),
    scheduledContextKey,
    latestContextKey: latestMoveExecutionReadiness.contextKey,
  });
}

export function getLatestMoveExecutionContextKey() {
  return latestMoveExecutionReadiness.contextKey;
}

export function tryClaimMoveAction(actionKey: string) {
  if (!canExecuteMoveActionNow(actionKey)) return false;
  cleanupSettledMoveActionClaims();
  const actionContext = getMoveActionContext(actionKey);
  const claimKey = getClaimKey(actionContext);
  if (!claimKey || moveActionClaims.has(claimKey)) return false;
  moveActionClaims.set(claimKey, {
    actionKey,
    opportunityKey: claimKey,
    baseOpportunityKey: latestMoveExecutionReadiness.opportunityKey,
    settled: false,
  });
  return true;
}

export function ensureMoveActionClaimed(actionKey: string) {
  for (const claim of moveActionClaims.values()) {
    if (claim.actionKey === actionKey) return true;
  }
  return tryClaimMoveAction(actionKey);
}

export function settleMoveActionClaim(actionKey: string) {
  for (const claim of moveActionClaims.values()) {
    if (claim.actionKey !== actionKey) continue;
    claim.settled = true;
    cleanupSettledMoveActionClaims();
    return true;
  }
  return false;
}

export function releaseMoveActionClaim(actionKey: string) {
  let released = false;
  for (const [claimKey, claim] of moveActionClaims) {
    if (claim.actionKey !== actionKey) continue;
    moveActionClaims.delete(claimKey);
    released = true;
  }
  return released;
}

export function clearMoveActionClaims() {
  moveActionClaims.clear();
}

function getMoveActionScopeKey(actionKey: string) {
  const context = getMoveActionContext(actionKey);
  return context.opportunityKey;
}

export function isMoveActionAlreadyClaimed(actionKey: string, claimedActionKeys: Set<string>) {
  const scopeKey = getMoveActionScopeKey(actionKey);
  if (!scopeKey) return false;
  return Array.from(claimedActionKeys).some(
    (claimedActionKey) => getMoveActionScopeKey(claimedActionKey) === scopeKey,
  );
}

export function resetMoveExecutionPolicyForTests() {
  latestMoveExecutionReadiness = {
    canRequestMove: false,
    canSubmitTurnAction: false,
    contextKey: '',
    baseContextKey: '',
    opportunityKey: '',
    hasMoveOpportunity: false,
  };
  latestMoveTransitionReadiness = { actionReady: true, contextKey: '' };
  moveActionClaims.clear();
}
