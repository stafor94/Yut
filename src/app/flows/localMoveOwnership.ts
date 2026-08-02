import {
  isAuthoritativeCommitReduction,
  reduceAuthoritativeGameAction,
} from '../../features/room/services/roomAuthoritativeReducer';
import {
  localMovePresentationLifecycle,
  type LocalMovePresentationLifecycle,
} from './localMovePresentationLifecycle';

export type AuthoritativeDeliveryClassification = 'local-echo' | 'remote-action' | 'stale';
export type AuthoritativeDeliveryKind = 'action-result' | 'state-snapshot';

export type LocalMoveLedgerRecord = {
  roomId: string;
  clientMutationId: string;
  startSequence: number;
  startTurnIndex: number;
  pieceId: string;
  movingGroupIds: string[];
  fromNodeId: string;
  toNodeId: string;
  pathNodeIds: string[];
  finalPieces: unknown[];
  finalState: Record<string, unknown>;
  resultFingerprint: string;
  localPresentationCompleted: boolean;
  serverSequenceAcked: boolean;
  serverSequence: number;
  serverStateVersion: number;
  fingerprintMatched: boolean | null;
  hardResyncStarted: boolean;
};

type RegisterLocalMoveInput = Omit<LocalMoveLedgerRecord,
  | 'localPresentationCompleted'
  | 'serverSequenceAcked'
  | 'serverSequence'
  | 'serverStateVersion'
  | 'fingerprintMatched'
  | 'hardResyncStarted'
>;

type ObserveAuthoritativeResultInput = {
  clientMutationId: string;
  sequence?: number;
  stateVersion?: number;
  resultFingerprint?: string;
};

type DeliveryIdentityInput = {
  clientMutationId?: unknown;
  sequence?: unknown;
  stateVersion?: unknown;
  deliveryKind?: unknown;
};

type LocalMoveAction = {
  type: string;
  actorId: string;
  payload?: Record<string, unknown>;
};

type LocalMoveState = Record<string, unknown> & {
  playMode?: 'individual' | 'team';
  pieceCount?: 1 | 2 | 3 | 4;
  stackedRollMode?: boolean;
  gameSeats?: Array<{ id?: string; team?: '청팀' | '홍팀' }>;
  pieces?: unknown[];
  turnIndex?: number;
  lastSequence?: number;
  turnVersion?: number;
};

export type PreparedLocalMoveOwnership = {
  record: RegisterLocalMoveInput;
  finalState: LocalMoveState;
  payload: Record<string, unknown>;
};

type LocalMoveSettlementExpectation = Pick<LocalMovePresentationLifecycle, 'expectNextSettlement'>;

const toFiniteInteger = (value: unknown) => {
  const numericValue = Number(value ?? 0);
  return Number.isFinite(numericValue) ? Math.max(0, Math.trunc(numericValue)) : 0;
};

const stableValue = (value: unknown): unknown => {
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Date) return value.getTime();
  if ('toMillis' in value && typeof value.toMillis === 'function') return Number(value.toMillis()) || 0;
  if (Array.isArray(value)) return value.map(stableValue);
  return Object.keys(value)
    .sort()
    .reduce<Record<string, unknown>>((normalized, key) => {
      normalized[key] = stableValue((value as Record<string, unknown>)[key]);
      return normalized;
    }, {});
};

const normalizePiece = (piece: unknown) => {
  if (!piece || typeof piece !== 'object' || Array.isArray(piece)) return piece;
  const source = piece as Record<string, unknown>;
  return {
    id: String(source.id ?? ''),
    ownerId: String(source.ownerId ?? ''),
    nodeId: String(source.nodeId ?? ''),
    nodeIndex: Number(source.nodeIndex ?? 0),
    started: source.started === true,
    finished: source.finished === true,
    previousNodeId: typeof source.previousNodeId === 'string' ? source.previousNodeId : '',
  };
};

const normalizeRoll = (roll: unknown) => {
  if (!roll || typeof roll !== 'object' || Array.isArray(roll)) return null;
  const source = roll as Record<string, unknown>;
  return {
    name: String(source.name ?? ''),
    steps: Number(source.steps ?? 0),
    bonus: source.bonus === true,
  };
};

const normalizePendingItemPickup = (value: unknown) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  return {
    ownerId: String(source.ownerId ?? ''),
    itemId: String(source.itemId ?? ''),
    itemType: String(source.itemType ?? ''),
    existingItemType: String(source.existingItemType ?? ''),
    nextTurnIndex: Number(source.nextTurnIndex ?? 0),
    resumeItemPromptTiming: source.resumeItemPromptTiming ?? null,
    resumePendingAfterMoveTurnIndex: source.resumePendingAfterMoveTurnIndex ?? null,
    resumeTurnDeadlineKind: source.resumeTurnDeadlineKind ?? null,
  };
};

const normalizeOwnedItems = (value: unknown) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.keys(value as Record<string, unknown>)
    .sort()
    .reduce<Record<string, string[]>>((normalized, seatId) => {
      const items = (value as Record<string, unknown>)[seatId];
      normalized[seatId] = Array.isArray(items) ? items.map(String).sort() : [];
      return normalized;
    }, {});
};

const normalizeStringArray = (value: unknown) => Array.isArray(value) ? value.map(String).filter(Boolean) : [];

const BONUS_ROLL_NAMES = new Set(['윷', '모', '황금 윷']);

const getPendingLocalMoveRoll = (action: LocalMoveAction) => {
  const payloadRollName = typeof action.payload?.rollName === 'string' ? action.payload.rollName : '';
  const payloadRollSteps = Number(action.payload?.rollSteps);
  if (payloadRollName && Number.isFinite(payloadRollSteps)) {
    return {
      name: payloadRollName,
      steps: payloadRollSteps,
      bonus: BONUS_ROLL_NAMES.has(payloadRollName),
    };
  }

  const clientActionId = typeof action.payload?.clientActionId === 'string' ? action.payload.clientActionId : '';
  const tokens = clientActionId.split(':');
  if (tokens.length < 6 || tokens[0] !== 'move_piece' || tokens[1] !== action.actorId) return null;
  const rollName = tokens[4] ?? '';
  const rollSteps = Number(tokens[5]);
  if (!rollName || rollName === 'ready' || !Number.isFinite(rollSteps)) return null;
  return {
    name: rollName,
    steps: rollSteps,
    bonus: BONUS_ROLL_NAMES.has(rollName),
  };
};

const getLocalMoveReductionState = (state: LocalMoveState, action: LocalMoveAction): LocalMoveState => {
  if (normalizeRoll(state.roll)) return state;
  const pendingRoll = getPendingLocalMoveRoll(action);
  return pendingRoll ? { ...state, roll: pendingRoll } : state;
};

export function makeLocalMoveResultFingerprint(state: Record<string, unknown>) {
  const pieces = Array.isArray(state.pieces) ? state.pieces.map(normalizePiece).sort((left, right) => {
    const leftId = left && typeof left === 'object' && 'id' in left ? String(left.id) : '';
    const rightId = right && typeof right === 'object' && 'id' in right ? String(right.id) : '';
    return leftId.localeCompare(rightId);
  }) : [];
  const rollStack = Array.isArray(state.rollStack) ? state.rollStack.map(normalizeRoll) : [];
  const boardItems = Array.isArray(state.boardItems)
    ? state.boardItems.map((item) => stableValue(item)).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)))
    : [];
  const trapNodes = Array.isArray(state.trapNodes)
    ? state.trapNodes.map((trap) => stableValue(trap)).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)))
    : [];

  return JSON.stringify(stableValue({
    pieces,
    turnIndex: Number(state.turnIndex ?? 0),
    roll: normalizeRoll(state.roll),
    rollStack,
    selectedRollStackIndex: typeof state.selectedRollStackIndex === 'number' ? state.selectedRollStackIndex : null,
    rollStackClosed: state.rollStackClosed === true,
    boardItems,
    ownedItems: normalizeOwnedItems(state.ownedItems),
    trapNodes,
    shieldedPieceIds: normalizeStringArray(state.shieldedPieceIds).sort(),
    lastMovedPieceIds: normalizeStringArray(state.lastMovedPieceIds),
    lastMovedSeatId: String(state.lastMovedSeatId ?? ''),
    branchChoice: String(state.branchChoice ?? ''),
    pendingItemPickup: normalizePendingItemPickup(state.pendingItemPickup),
    itemPromptTiming: state.itemPromptTiming ?? null,
    pendingAfterMoveTurnIndex: typeof state.pendingAfterMoveTurnIndex === 'number' ? state.pendingAfterMoveTurnIndex : null,
    turnDeadlineKind: String(state.turnDeadlineKind ?? ''),
    completedSeatIds: normalizeStringArray(state.completedSeatIds),
    rankingSeatIds: normalizeStringArray(state.rankingSeatIds),
    gameEndMode: String(state.gameEndMode ?? ''),
    lastFinishedSeatId: String(state.lastFinishedSeatId ?? ''),
    winner: String(state.winner ?? ''),
  }));
}

export function prepareLocalMoveOwnership({
  roomId,
  state,
  action,
}: {
  roomId: string;
  state: LocalMoveState | null | undefined;
  action: LocalMoveAction;
}): PreparedLocalMoveOwnership | null {
  const clientMutationId = typeof action.payload?.clientActionId === 'string' ? action.payload.clientActionId : '';
  if (!roomId || !state || !clientMutationId || action.type !== 'move_piece') return null;
  if (action.payload?.recoveredByCoordinator === true
    || typeof action.payload?.automationSource === 'string'
    || typeof action.payload?.coordinatorSeatId === 'string') return null;
  if ((state.playMode !== 'individual' && state.playMode !== 'team')
    || ![1, 2, 3, 4].includes(Number(state.pieceCount))
    || typeof state.stackedRollMode !== 'boolean'
    || !Array.isArray(state.gameSeats)
    || !state.gameSeats.length) return null;

  const sides = state.gameSeats
    .filter((seat): seat is { id: string; team: '청팀' | '홍팀' } => Boolean(
      seat
      && typeof seat.id === 'string'
      && seat.id
      && (seat.team === '청팀' || seat.team === '홍팀'),
    ))
    .map((seat) => ({ id: seat.id, team: seat.team }));
  if (sides.length !== state.gameSeats.length) return null;

  const reductionState = getLocalMoveReductionState(state, action);
  const reduction = reduceAuthoritativeGameAction(
    reductionState as Parameters<typeof reduceAuthoritativeGameAction>[0],
    action as Parameters<typeof reduceAuthoritativeGameAction>[1],
    {
      playMode: reductionState.playMode,
      pieceCount: reductionState.pieceCount,
      stackedRollMode: reductionState.stackedRollMode,
    },
    sides,
  );
  if (!isAuthoritativeCommitReduction(reduction)) return null;

  const payload = reduction.payload ?? {};
  const pieceId = String(payload.pieceId ?? action.payload?.pieceId ?? '');
  const pathNodeIds = normalizeStringArray(payload.pathNodeIds);
  if (!pieceId || !pathNodeIds.length) return null;

  const finalState: LocalMoveState = {
    ...reductionState,
    ...reduction.patch,
    lastClientMutationId: clientMutationId,
  };
  const finalPieces = Array.isArray(finalState.pieces) ? finalState.pieces : [];
  const record: RegisterLocalMoveInput = {
    roomId,
    clientMutationId,
    startSequence: toFiniteInteger(state.lastSequence),
    startTurnIndex: toFiniteInteger(state.turnIndex),
    pieceId,
    movingGroupIds: normalizeStringArray(payload.movingGroupIds),
    fromNodeId: String(payload.fromNodeId ?? ''),
    toNodeId: String(payload.toNodeId ?? ''),
    pathNodeIds,
    finalPieces,
    finalState,
    resultFingerprint: makeLocalMoveResultFingerprint(finalState),
  };
  return { record, finalState, payload };
}

export class LocalMoveLedger {
  private records = new Map<string, LocalMoveLedgerRecord>();

  constructor(private readonly settlementExpectation?: LocalMoveSettlementExpectation) {}

  register(input: RegisterLocalMoveInput) {
    const record: LocalMoveLedgerRecord = {
      ...input,
      movingGroupIds: [...input.movingGroupIds],
      pathNodeIds: [...input.pathNodeIds],
      finalPieces: [...input.finalPieces],
      finalState: input.finalState,
      localPresentationCompleted: false,
      serverSequenceAcked: false,
      serverSequence: 0,
      serverStateVersion: 0,
      fingerprintMatched: null,
      hardResyncStarted: false,
    };
    this.records.set(input.clientMutationId, record);
    this.settlementExpectation?.expectNextSettlement(input.clientMutationId, input.pieceId, input.pathNodeIds);
    return record;
  }

  get(clientMutationId: unknown) {
    return typeof clientMutationId === 'string' ? this.records.get(clientMutationId) : undefined;
  }

  has(clientMutationId: unknown) {
    return Boolean(this.get(clientMutationId));
  }

  findByRoom(roomId: string) {
    for (const record of this.records.values()) {
      if (record.roomId === roomId) return record;
    }
    return undefined;
  }

  markPresentationCompleted(clientMutationId: string) {
    const record = this.records.get(clientMutationId);
    if (!record) return false;
    record.localPresentationCompleted = true;
    return this.cleanupIfSettled(record);
  }

  observeAuthoritativeResult(input: ObserveAuthoritativeResultInput) {
    const record = this.records.get(input.clientMutationId);
    if (!record) return { status: 'unknown' as const, record: undefined };
    record.serverSequence = Math.max(record.serverSequence, toFiniteInteger(input.sequence));
    record.serverStateVersion = Math.max(record.serverStateVersion, toFiniteInteger(input.stateVersion));
    record.serverSequenceAcked = record.serverSequence > 0;
    if (record.serverSequence > 0) record.finalState.lastSequence = record.serverSequence;
    if (record.serverStateVersion > 0) record.finalState.turnVersion = record.serverStateVersion;
    record.finalState.lastClientMutationId = record.clientMutationId;
    if (typeof input.resultFingerprint === 'string' && input.resultFingerprint) {
      record.fingerprintMatched = input.resultFingerprint === record.resultFingerprint;
    }
    const status = record.fingerprintMatched === false
      ? 'mismatch' as const
      : record.fingerprintMatched === true
        ? 'matched' as const
        : 'pending' as const;
    const snapshot = {
      ...record,
      movingGroupIds: [...record.movingGroupIds],
      pathNodeIds: [...record.pathNodeIds],
      finalPieces: [...record.finalPieces],
      finalState: { ...record.finalState },
    };
    this.cleanupIfSettled(record);
    return { status, record: snapshot };
  }

  claimHardResync(clientMutationId: string) {
    const record = this.records.get(clientMutationId);
    if (!record || record.hardResyncStarted) return false;
    record.hardResyncStarted = true;
    return true;
  }

  isHardResyncStarted(clientMutationId: string) {
    return this.records.get(clientMutationId)?.hardResyncStarted === true;
  }

  remove(clientMutationId: string) {
    return this.records.delete(clientMutationId);
  }

  clearRoom(roomId: string) {
    if (!roomId) return;
    for (const [clientMutationId, record] of this.records) {
      if (record.roomId === roomId) this.records.delete(clientMutationId);
    }
  }

  clear() {
    this.records.clear();
  }

  size() {
    return this.records.size;
  }

  private cleanupIfSettled(record: LocalMoveLedgerRecord) {
    const settled = record.localPresentationCompleted
      && record.serverSequenceAcked
      && record.fingerprintMatched === true;
    if (settled) this.records.delete(record.clientMutationId);
    return settled;
  }
}

export const localMoveLedger = new LocalMoveLedger(localMovePresentationLifecycle);

export function classifyAuthoritativeDelivery(
  input: DeliveryIdentityInput,
  _applied: { lastAppliedSequence: number; lastAppliedStateVersion: number },
  ledger: LocalMoveLedger = localMoveLedger,
): AuthoritativeDeliveryClassification {
  const clientMutationId = typeof input.clientMutationId === 'string' ? input.clientMutationId : '';
  return clientMutationId && ledger.has(clientMutationId)
    ? 'local-echo'
    : 'remote-action';
}

export function getAuthoritativeDeliveryIdentity(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { clientMutationId: '', sequence: 0, stateVersion: 0, deliveryKind: 'state-snapshot' as const };
  }
  const record = value as Record<string, unknown>;
  const sequenceEvent = record.sequenceEvent && typeof record.sequenceEvent === 'object'
    ? record.sequenceEvent as Record<string, unknown>
    : null;
  const stateAfter = record.stateAfter && typeof record.stateAfter === 'object'
    ? record.stateAfter as Record<string, unknown>
    : null;
  const patch = record.patch && typeof record.patch === 'object'
    ? record.patch as Record<string, unknown>
    : null;
  const payload = record.payload && typeof record.payload === 'object'
    ? record.payload as Record<string, unknown>
    : null;
  const clientMutationId = sequenceEvent?.clientMutationId
    ?? stateAfter?.lastClientMutationId
    ?? record.lastClientMutationId
    ?? patch?.lastClientMutationId
    ?? payload?.clientMutationId;
  const deliveryKind: AuthoritativeDeliveryKind = sequenceEvent || stateAfter || patch
    ? 'action-result'
    : 'state-snapshot';
  return {
    clientMutationId: typeof clientMutationId === 'string' ? clientMutationId : '',
    sequence: toFiniteInteger(record.sequence ?? sequenceEvent?.sequence ?? stateAfter?.lastSequence ?? patch?.lastSequence),
    stateVersion: toFiniteInteger(record.turnVersion ?? stateAfter?.turnVersion ?? patch?.turnVersion),
    deliveryKind,
  };
}
