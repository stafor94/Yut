export type AuthoritativeDeliveryClassification = 'local-echo' | 'remote-action' | 'stale';

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
};

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
    shieldedPieceIds: Array.isArray(state.shieldedPieceIds) ? state.shieldedPieceIds.map(String).sort() : [],
    lastMovedPieceIds: Array.isArray(state.lastMovedPieceIds) ? state.lastMovedPieceIds.map(String) : [],
    lastMovedSeatId: String(state.lastMovedSeatId ?? ''),
    branchChoice: String(state.branchChoice ?? ''),
    pendingItemPickup: normalizePendingItemPickup(state.pendingItemPickup),
    itemPromptTiming: state.itemPromptTiming ?? null,
    pendingAfterMoveTurnIndex: typeof state.pendingAfterMoveTurnIndex === 'number' ? state.pendingAfterMoveTurnIndex : null,
    turnDeadlineKind: String(state.turnDeadlineKind ?? ''),
    completedSeatIds: Array.isArray(state.completedSeatIds) ? state.completedSeatIds.map(String) : [],
    rankingSeatIds: Array.isArray(state.rankingSeatIds) ? state.rankingSeatIds.map(String) : [],
    gameEndMode: String(state.gameEndMode ?? ''),
    lastFinishedSeatId: String(state.lastFinishedSeatId ?? ''),
    winner: String(state.winner ?? ''),
  }));
}

export class LocalMoveLedger {
  private records = new Map<string, LocalMoveLedgerRecord>();

  register(input: RegisterLocalMoveInput) {
    const record: LocalMoveLedgerRecord = {
      ...input,
      movingGroupIds: [...input.movingGroupIds],
      pathNodeIds: [...input.pathNodeIds],
      finalPieces: [...input.finalPieces],
      localPresentationCompleted: false,
      serverSequenceAcked: false,
      serverSequence: 0,
      serverStateVersion: 0,
      fingerprintMatched: null,
      hardResyncStarted: false,
    };
    this.records.set(input.clientMutationId, record);
    return record;
  }

  get(clientMutationId: unknown) {
    return typeof clientMutationId === 'string' ? this.records.get(clientMutationId) : undefined;
  }

  has(clientMutationId: unknown) {
    return Boolean(this.get(clientMutationId));
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
    if (typeof input.resultFingerprint === 'string' && input.resultFingerprint) {
      record.fingerprintMatched = input.resultFingerprint === record.resultFingerprint;
    }
    const status = record.fingerprintMatched === false ? 'mismatch' as const : 'matched' as const;
    const snapshot = { ...record, movingGroupIds: [...record.movingGroupIds], pathNodeIds: [...record.pathNodeIds], finalPieces: [...record.finalPieces] };
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

export const localMoveLedger = new LocalMoveLedger();

export function classifyAuthoritativeDelivery(
  input: DeliveryIdentityInput,
  applied: { lastAppliedSequence: number; lastAppliedStateVersion: number },
  ledger: LocalMoveLedger = localMoveLedger,
): AuthoritativeDeliveryClassification {
  const clientMutationId = typeof input.clientMutationId === 'string' ? input.clientMutationId : '';
  if (clientMutationId && ledger.has(clientMutationId)) return 'local-echo';

  const sequence = toFiniteInteger(input.sequence);
  const stateVersion = toFiniteInteger(input.stateVersion);
  if (sequence > 0 && sequence <= Math.max(0, applied.lastAppliedSequence)) return 'stale';
  if (sequence <= 0 && stateVersion > 0 && stateVersion <= Math.max(0, applied.lastAppliedStateVersion)) return 'stale';
  return 'remote-action';
}

export function getAuthoritativeDeliveryIdentity(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { clientMutationId: '', sequence: 0, stateVersion: 0 };
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
  return {
    clientMutationId: typeof clientMutationId === 'string' ? clientMutationId : '',
    sequence: toFiniteInteger(record.sequence ?? sequenceEvent?.sequence ?? stateAfter?.lastSequence ?? patch?.lastSequence),
    stateVersion: toFiniteInteger(record.turnVersion ?? stateAfter?.turnVersion ?? patch?.turnVersion),
  };
}
