type DiagnosticParams = Record<string, any>;

type ExportRecord = Record<string, unknown>;
type BugReportSequenceExport = { capturedAt: string; roomId: string; latestState: ExportRecord | null; sequences: ExportRecord[] };

const BUG_REPORT_STATE_KEYS = [
  'turnIndex', 'turnOrderIds', 'initialTurnOrderIds', 'turnVersion', 'lastSequence', 'lastClientMutationId',
  'roll', 'rollStack', 'selectedRollStackIndex', 'rollStackClosed', 'pieces', 'gameSeats', 'ownedItems',
  'boardItems', 'trapNodes', 'shieldedPieceIds', 'pendingTrapPlacement', 'itemPromptTiming',
  'pendingAfterMoveTurnIndex', 'branchChoice', 'turnOrderPhase', 'turnOrderIntro', 'turnDeadlineAt',
  'turnDeadlineKind', 'rollLockUntil', 'rollResultReadyAt', 'lastMovedPieceIds', 'lastMovedSeatId',
  'winner', 'completedSeatIds', 'rankingSeatIds', 'gameEndMode',
] as const;

const BUG_REPORT_SEQUENCE_KEYS = [
  'sequence', 'type', 'actorId', 'action', 'payload', 'patch', 'clientMutationId', 'clientCreatedAt', 'createdAt',
] as const;

const BUG_REPORT_RECENT_SEQUENCE_LIMIT = 30;

function isPlainObject(value: unknown): value is ExportRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function sanitizeExportValue(value: unknown): unknown {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof (value as { toDate?: unknown }).toDate === 'function') {
    const date = (value as { toDate: () => Date }).toDate();
    return date instanceof Date && !Number.isNaN(date.getTime()) ? date.toISOString() : undefined;
  }
  if (Array.isArray(value)) {
    return value.map(sanitizeExportValue).filter((entry) => entry !== undefined);
  }
  return Object.fromEntries(
    Object.entries(value as ExportRecord)
      .filter(([key]) => key !== 'logs' && !/effect|animation/i.test(key))
      .map(([key, entry]) => [key, sanitizeExportValue(entry)])
      .filter(([, entry]) => entry !== undefined),
  );
}

function pickDefined(source: unknown, keys: readonly string[]): ExportRecord | undefined {
  if (!isPlainObject(source)) return undefined;
  const result: ExportRecord = {};
  for (const key of keys) {
    const value = sanitizeExportValue(source[key]);
    if (value !== undefined) result[key] = value;
  }
  return result;
}

function sanitizePieces(value: unknown): unknown {
  if (!Array.isArray(value)) return sanitizeExportValue(value);
  return value.map((piece) => pickDefined(piece, ['id', 'ownerId', 'nodeId', 'started', 'finished']) ?? {}).filter((piece) => Object.keys(piece).length > 0);
}

function sanitizeGameSeats(value: unknown): unknown {
  if (!Array.isArray(value)) return sanitizeExportValue(value);
  return value.map((seat) => pickDefined(seat, ['id', 'name', 'isAI', 'isSubstitutedByAI']) ?? {}).filter((seat) => Object.keys(seat).length > 0);
}

function sanitizeBoardItems(value: unknown): unknown {
  if (!Array.isArray(value)) return sanitizeExportValue(value);
  return value.map((item) => pickDefined(item, ['id', 'type', 'nodeId']) ?? {}).filter((item) => Object.keys(item).length > 0);
}

export function makeBugReportGameStateSnapshot(state: unknown): ExportRecord | null {
  const result = pickDefined(state, BUG_REPORT_STATE_KEYS);
  if (!result) return null;
  if ('pieces' in result) result.pieces = sanitizePieces((state as ExportRecord).pieces);
  if ('gameSeats' in result) result.gameSeats = sanitizeGameSeats((state as ExportRecord).gameSeats);
  if ('boardItems' in result) result.boardItems = sanitizeBoardItems((state as ExportRecord).boardItems);
  return result;
}

function makeBugReportSequence(sequence: unknown): ExportRecord | null {
  const result = pickDefined(sequence, BUG_REPORT_SEQUENCE_KEYS);
  if (!result) return null;
  if ('patch' in result) result.patch = makeBugReportGameStateSnapshot((sequence as ExportRecord).patch);
  return result;
}

export function makeBugReportSequenceExport(params: { capturedAt: string; roomId: string; latestState: unknown; sequences: unknown[] }): BugReportSequenceExport {
  const recentSequences = [...params.sequences]
    .filter((sequence) => isPlainObject(sequence))
    .sort((left, right) => Number(left.sequence ?? 0) - Number(right.sequence ?? 0))
    .slice(-BUG_REPORT_RECENT_SEQUENCE_LIMIT)
    .map(makeBugReportSequence)
    .filter((sequence): sequence is ExportRecord => Boolean(sequence));

  return {
    capturedAt: params.capturedAt,
    roomId: params.roomId,
    latestState: makeBugReportGameStateSnapshot(params.latestState),
    sequences: recentSequences,
  };
}



export const makeGameDiagnosticState = ({
  screen, activeRoomId, isWaitingRoomHost, onlineGameRole, isRoomManager, isOnlinePlayer,
  onlineGameCoordinatorSeatId, canCoordinateOnlineGame, canManageRoom, currentUserId, localSeatId,
  waitingRoomHostSeatId, allReady, pendingAiSeatCount, teamBalanced, displaySeats, message, actionErrorDialog,
  lastActionDiagnostic, remoteActionDiagnostics, lastManualSyncResolution, turnOrderIds,
  initialTurnOrderIds, completedSeatIds, rankingSeatIds, gameEndMode, lastFinishedSeatId,
  continuationRound, unfinishedRaceSeatIds, canShowContinueRaceButton, roll, rollInProgress,
  rollInProgressRef, coordinatorStateSaveKey, hasPendingGameStateSave, isRollLocked, rollLockUntil,
  rollResultReadyAt, effectiveRollResultReadyAt, rollLockClock, rollResultHolding, turnOrderIntro,
  activeTurnOrderIntro, waitingForOnlineTurnOrder, turnDeadlineAt, turnDeadlineKind, turnIndex, lastAppliedStateVersionRef,
  lastAppliedSequenceRef, syncPipelineDiagnostic, actionPipelineDiagnostic, turnHealthDiagnostic,
  pendingLocalRemoteActionCount, pendingLocalRemoteActionsRef, pendingLocalRemoteActionMetaRef,
  getPendingLocalRemoteActionType, turnActionTimeoutPenaltyBySeatId, activeSeat,
  getTurnActionTimeoutMs, getItemPromptTimeoutMs, processingActionIdsRef, completedActionIdsRef,
  lastMovedSeatId, lastMovedPieceIds, pieces, isMyTurn, canSubmitTurnAction, canRollNow,
  canMoveSelectedPiece, canRequestMove, turnActionBlockReasons, rollActionBlockReasons,
  moveActionBlockReasons, stalledTurnDetected, stalledTurnReason, stalledTurnAgeMs,
  stalledTurnSyncAgeMs, stalledTurnWatchKey, stalledTurnNeedsBranchChoice, stalledTurnFallbackPiece,
  stalledTurnMovablePieces, getStalledTurnSyncResolution, selectedPieceId, selectedPiece, selectedPieceCanMove,
  activeSeatPiecesOnBoard, fallbackMovablePiece, activeMovablePiece, selectedMoveSteps,
  canSeatControlPiece, visibleLogs, boardItems, ownedItems, trapNodes, shieldedPieceIds,
  pendingTrapPlacement, itemPromptTiming, branchChoice, turnActionTimeoutMs,
}: DiagnosticParams) => ({
  screen,
  activeRoomId,
  isWaitingRoomHost,
  onlineGameRole,
  isRoomManager,
  isOnlinePlayer,
  onlineGameCoordinatorSeatId,
  canCoordinateOnlineGame,
  canManageRoom,
  currentUserId,
  localSeatId,
  waitingRoomHostSeatId,
  allReady,
  pendingAiSeatCount,
  teamBalanced,
  seats: displaySeats.map((seat: any) => ({ id: seat.id, label: seat.label, ready: seat.ready, isAI: seat.isAI, isEmpty: seat.isEmpty, isHost: seat.isHost, team: seat.team })),
  message,
  actionErrorDialog,
  lastActionDiagnostic,
  remoteActionDiagnostics,
  lastManualSyncResolution,
  turnOrderIds,
  initialTurnOrderIds,
  completedSeatIds,
  rankingSeatIds,
  gameEndMode,
  lastFinishedSeatId,
  continuationRound,
  unfinishedRaceSeatIds,
  canShowContinueRaceButton,
  roll,
  rollInProgress,
  rollInProgressRef: rollInProgressRef.current,
  coordinatorStateSaveKey,
  hasPendingGameStateSave,
  isRollLocked,
  rollLockUntil,
  rollResultReadyAt,
  effectiveRollResultReadyAt,
  rollLockClock,
  rollResultHolding,
  turnOrderIntro,
  activeTurnOrderIntro,
  waitingForOnlineTurnOrder,
  turnDeadlineAt,
  turnDeadlineKind,
  turnDeadlineExpired: Boolean(turnDeadlineAt && Date.now() >= Number(turnDeadlineAt)),
  turnDeadlineRemainingMs: turnDeadlineAt ? Math.max(0, Number(turnDeadlineAt) - Date.now()) : 0,
  turnIndex,
  lastAppliedStateVersion: lastAppliedStateVersionRef.current,
  lastAppliedSequence: lastAppliedSequenceRef.current,
  syncPipeline: syncPipelineDiagnostic,
  actionPipeline: actionPipelineDiagnostic,
  turnHealth: turnHealthDiagnostic,
  pendingLocalRemoteActionCount,
  pendingLocalRemoteActions: Array.from(pendingLocalRemoteActionsRef.current).map((key) => {
    const meta = pendingLocalRemoteActionMetaRef.current.get(key);
    return { key, type: meta?.type ?? getPendingLocalRemoteActionType(key), ageMs: meta ? Math.max(0, Date.now() - meta.createdAt) : 0 };
  }),
  turnActionTimeoutPenaltyBySeatId,
  currentTurnActionTimeoutMs: activeSeat ? getTurnActionTimeoutMs(activeSeat.id) : turnActionTimeoutMs,
  currentItemPromptTimeoutMs: getItemPromptTimeoutMs(localSeatId),
  processingActionCount: processingActionIdsRef.current.size,
  completedActionCount: completedActionIdsRef.current.size,
  lastMovedSeatId,
  lastMovedPieceIds,
  pieces: pieces.map((piece: any) => ({ id: piece.id, ownerId: piece.ownerId, nodeId: piece.nodeId, started: piece.started, finished: piece.finished })),
  activeSeat: activeSeat ? { id: activeSeat.id, label: activeSeat.label, name: activeSeat.name, isAI: activeSeat.isAI } : null,
  isMyTurn,
  canSubmitTurnAction,
  canRollNow,
  canMoveSelectedPiece,
  canRequestMove,
  turnActionBlockReasons,
  rollActionBlockReasons,
  moveActionBlockReasons,
  stalledTurn: {
    detected: stalledTurnDetected,
    reason: stalledTurnReason,
    ageMs: stalledTurnAgeMs,
    syncAgeMs: stalledTurnSyncAgeMs,
    recoveryAfterMs: turnActionTimeoutMs,
    watchKey: stalledTurnWatchKey,
    needsBranchChoice: stalledTurnNeedsBranchChoice,
    fallbackPiece: stalledTurnFallbackPiece ? { id: stalledTurnFallbackPiece.id, ownerId: stalledTurnFallbackPiece.ownerId, label: stalledTurnFallbackPiece.label, nodeId: stalledTurnFallbackPiece.nodeId, started: stalledTurnFallbackPiece.started, finished: stalledTurnFallbackPiece.finished } : null,
    movablePieces: stalledTurnMovablePieces.map((piece: any) => ({ id: piece.id, ownerId: piece.ownerId, label: piece.label, nodeId: piece.nodeId, started: piece.started, finished: piece.finished })),
    syncResolution: getStalledTurnSyncResolution(),
  },
  selectedPieceId,
  selectedPieceCanMove,
  activeSeatPiecesOnBoard,
  fallbackMovablePiece: fallbackMovablePiece ? { id: fallbackMovablePiece.id, ownerId: fallbackMovablePiece.ownerId, label: fallbackMovablePiece.label, started: fallbackMovablePiece.started, finished: fallbackMovablePiece.finished, nodeId: fallbackMovablePiece.nodeId } : null,
  activeMovablePiece: activeMovablePiece ? { id: activeMovablePiece.id, ownerId: activeMovablePiece.ownerId, label: activeMovablePiece.label, started: activeMovablePiece.started, finished: activeMovablePiece.finished, nodeId: activeMovablePiece.nodeId } : null,
  movablePiecesForActiveSeat: activeSeat && roll ? pieces
    .filter((piece: any) => canSeatControlPiece(activeSeat, piece) && !piece.finished && (selectedMoveSteps >= 0 || piece.started))
    .map((piece: any) => ({ id: piece.id, ownerId: piece.ownerId, label: piece.label, nodeId: piece.nodeId, started: piece.started, finished: piece.finished })) : [],
  moveSelectionReason: selectedPieceCanMove ? 'selected-piece' : fallbackMovablePiece ? (activeSeatPiecesOnBoard ? 'fallback-on-board' : 'fallback-off-board-first') : 'none',
  selectedPiece: selectedPiece ? { id: selectedPiece.id, ownerId: selectedPiece.ownerId, started: selectedPiece.started, finished: selectedPiece.finished, nodeId: selectedPiece.nodeId } : null,
  logsSummary: {
    visibleCount: visibleLogs.length,
    latestVisibleLogId: visibleLogs.reduce((maxId: number, log: any) => Math.max(maxId, Number(log.id) || 0), 0),
    firstVisibleLogId: Number(visibleLogs[0]?.id ?? 0),
    lastVisibleLogId: Number(visibleLogs[visibleLogs.length - 1]?.id ?? 0),
  },
  logs: visibleLogs.map((log: any) => ({ id: log.id, text: log.text })),
  boardItems,
  ownedItems,
  trapNodes,
  shieldedPieceIds,
  pendingTrapPlacement,
  itemPromptTiming,
  branchChoice,
});
