import {
  GOLDEN_YUT_CHOICES,
  getRollTimingZone,
  makeDisplaySticks,
  rollYutResultWithTiming,
  shouldFallForTimingZone,
  type RollTimingZone,
  type YutResult,
  type YutStick,
} from '../../../game-core/roll';
import {
  getRollTimingInitialPositionPercentForDeadline,
  getRollTimingMotionState,
  rollTimingOpportunitySnapshotCache,
} from '../../../game-core/rollTimingMotion';
import type { BranchChoice } from '../../../game-core/board/board';
import { getRollStackSelectionAvailability } from '../../../game-core/rollStackSelection';
import { runWithTimeoutRollClientDeadline } from './timeoutRollClientFallback';
import { TURN_ACTION_TIMEOUT_MS } from './roomTiming';

export const ROLL_TIMEOUT_RESOLVER_VERSION = 1 as const;

const normalizeSeedPart = (value: unknown) => String(value ?? '');

const hashSeed = (parts: unknown[]) => {
  let hash = 0x811c9dc5;
  for (const character of parts.map(normalizeSeedPart).join('|')) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
};

export const createRollTimeoutRandom = (timeoutDeadlineAt: number) => {
  let state = hashSeed([ROLL_TIMEOUT_RESOLVER_VERSION, Math.trunc(timeoutDeadlineAt)]) || 0x6d2b79f5;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 0x100000000;
  };
};

/** Run the synchronous timeout roll callback with the exact random stream used by recovery. */
export const runWithRollTimeoutRandom = <T>(timeoutDeadlineAt: number, operation: () => T): T => (
  runWithTimeoutRollClientDeadline(timeoutDeadlineAt, () => {
    const originalRandom = Math.random;
    Math.random = createRollTimeoutRandom(timeoutDeadlineAt);
    try {
      return operation();
    } finally {
      Math.random = originalRandom;
    }
  })
);

/**
 * The active client freezes and submits the canonical orb position at the deadline.
 * If that client disappears, coordinators reconstruct the same deadline-seeded
 * opportunity instead of falling back to a separate fixed Bad position.
 */
export const resolveRollTimeout = (
  deadlineAt: number,
  timeoutWindowMs = TURN_ACTION_TIMEOUT_MS,
): { rollTimingZone: RollTimingZone; timingPositionPercent: number } => {
  const normalizedWindowMs = Number.isFinite(timeoutWindowMs) && timeoutWindowMs > 0
    ? timeoutWindowMs
    : TURN_ACTION_TIMEOUT_MS;
  const opportunity = rollTimingOpportunitySnapshotCache.get({
    key: `timeout:${deadlineAt}:${normalizedWindowMs}`,
    startedAt: deadlineAt - normalizedWindowMs,
    deadlineAt,
  });
  const { positionPercent: timingPositionPercent } = getRollTimingMotionState({
    initialPositionPercent: opportunity.initialPositionPercent,
    elapsedMs: normalizedWindowMs,
  });
  return {
    rollTimingZone: getRollTimingZone(timingPositionPercent),
    timingPositionPercent,
  };
};

/** One authoritative timeout action per game, turn, stage, actor, and deadline. */
export const makeTimeoutActionKey = (params: {
  roomId?: string;
  stage: string;
  actorId: string;
  timeoutDeadlineAt: number;
  gameStartedAt?: number | null;
  turnIndex?: number;
  resolverVersion?: number;
  turnVersion?: number;
  sequence?: number;
  extra?: string;
}) => {
  if (params.stage === 'move') {
    return ['timeout', params.roomId ?? 'local', 'move', params.actorId, Math.trunc(params.timeoutDeadlineAt)].join(':');
  }
  return [
    'timeout',
    `v${params.resolverVersion ?? ROLL_TIMEOUT_RESOLVER_VERSION}`,
    params.roomId ?? 'local',
    Math.trunc(Number(params.gameStartedAt ?? 0)),
    params.stage,
    params.actorId,
    Math.trunc(Number(params.turnIndex ?? 0)),
    Math.trunc(params.timeoutDeadlineAt),
  ].join(':');
};

export type RollTimeoutResolution = Readonly<{
  resolverVersion: typeof ROLL_TIMEOUT_RESOLVER_VERSION;
  actionKey: string;
  initialPositionPercent: number;
  initialDirection: 'forward';
  timingPositionPercent: number;
  rollTimingZone: RollTimingZone;
  clientRollResult: YutResult;
  sticks: readonly YutStick[];
  clientFallOccurred: boolean;
  clientFallCount: number;
}>;

/**
 * Resolves every random-looking part of a timed-out roll from one immutable turn
 * identity. UI submission, retry, reconnect recovery, and coordinator fallback
 * therefore produce the same gameplay payload.
 */
export const resolveRollTimeoutAction = (params: {
  roomId: string;
  actorId: string;
  timeoutDeadlineAt: number;
  timeoutWindowMs?: number;
  gameStartedAt?: number | null;
  turnIndex?: number;
  stage?: 'roll' | 'golden_yut';
  selectedGoldenYutResult?: YutResult | null;
  timingPositionPercent?: number;
  rollTimingZone?: RollTimingZone;
}): RollTimeoutResolution => {
  const stage = params.stage ?? (params.selectedGoldenYutResult ? 'golden_yut' : 'roll');
  const actionKey = makeTimeoutActionKey({
    roomId: params.roomId,
    stage,
    actorId: params.actorId,
    timeoutDeadlineAt: params.timeoutDeadlineAt,
    gameStartedAt: params.gameStartedAt,
    turnIndex: params.turnIndex,
    resolverVersion: ROLL_TIMEOUT_RESOLVER_VERSION,
  });
  const fallbackTiming = resolveRollTimeout(params.timeoutDeadlineAt, params.timeoutWindowMs);
  const timingPositionPercent = Number.isFinite(params.timingPositionPercent)
    ? Number(params.timingPositionPercent)
    : fallbackTiming.timingPositionPercent;
  const rollTimingZone = params.rollTimingZone ?? getRollTimingZone(timingPositionPercent);
  const random = createRollTimeoutRandom(params.timeoutDeadlineAt);
  const rolledResult = params.selectedGoldenYutResult
    ? { ...params.selectedGoldenYutResult }
    : rollYutResultWithTiming(rollTimingZone, random).result;
  const clientFallOccurred = params.selectedGoldenYutResult
    ? false
    : shouldFallForTimingZone(rollTimingZone, random);
  const clientFallCount = clientFallOccurred
    ? Math.floor(random() * 4) + 1
    : 0;

  return Object.freeze({
    resolverVersion: ROLL_TIMEOUT_RESOLVER_VERSION,
    actionKey,
    initialPositionPercent: getRollTimingInitialPositionPercentForDeadline(params.timeoutDeadlineAt),
    initialDirection: 'forward' as const,
    timingPositionPercent,
    rollTimingZone,
    clientRollResult: Object.freeze({ ...rolledResult }),
    sticks: Object.freeze(makeDisplaySticks(rolledResult).map((stick) => Object.freeze({ ...stick }))),
    clientFallOccurred,
    clientFallCount,
  });
};

export type MoveTimeoutContextReason = 'selected' | 'default-first' | 'first-selectable' | 'single' | 'non-stacked' | 'unresolved';
export type MoveTimeoutContext = {
  roll: YutResult | null;
  rollStackIndex: number | null;
  steps: number;
  reason: MoveTimeoutContextReason;
};

const isValidTimeoutMoveRoll = (value: YutResult | null | undefined): value is YutResult => Boolean(
  value
  && typeof value.name === 'string'
  && Number.isFinite(value.steps),
);

const makeResolvedTimeoutMoveContext = (
  roll: YutResult,
  rollStackIndex: number | null,
  reason: Exclude<MoveTimeoutContextReason, 'unresolved'>,
): MoveTimeoutContext => ({
  roll: { ...roll },
  rollStackIndex,
  steps: roll.steps,
  reason,
});

/**
 * Manual stack selection deliberately stays unresolved until the player chooses.
 * Timeout recovery instead snapshots one deterministic roll and stack index so a
 * delayed UI callback can never be the only path that advances the game.
 */
export const resolveMoveTimeoutContext = (params: {
  stackedRollMode: boolean;
  roll: YutResult | null;
  rollStack: YutResult[];
  rollStackClosed: boolean;
  selectedRollStackIndex: number | null;
  hasBackDoMovablePiece?: boolean;
}): MoveTimeoutContext => {
  const unresolved: MoveTimeoutContext = { roll: null, rollStackIndex: null, steps: 0, reason: 'unresolved' };
  if (!params.stackedRollMode) {
    return isValidTimeoutMoveRoll(params.roll)
      ? makeResolvedTimeoutMoveContext(params.roll, null, 'non-stacked')
      : unresolved;
  }
  if (!params.rollStackClosed || params.rollStack.length === 0) return unresolved;

  if (typeof params.selectedRollStackIndex === 'number') {
    if (!Number.isInteger(params.selectedRollStackIndex)
      || params.selectedRollStackIndex < 0
      || params.selectedRollStackIndex >= params.rollStack.length) return unresolved;
    const selectedRoll = params.rollStack[params.selectedRollStackIndex];
    return isValidTimeoutMoveRoll(selectedRoll)
      ? makeResolvedTimeoutMoveContext(selectedRoll, params.selectedRollStackIndex, 'selected')
      : unresolved;
  }

  if (!params.rollStack.every(isValidTimeoutMoveRoll)) return unresolved;
  const availability = getRollStackSelectionAvailability({
    rollStack: params.rollStack,
    hasBackDoMovablePiece: params.hasBackDoMovablePiece !== false,
  });
  const firstSelectableIndex = availability.findIndex(Boolean);
  if (firstSelectableIndex < 0) return unresolved;
  const firstSelectableRoll = params.rollStack[firstSelectableIndex];
  return makeResolvedTimeoutMoveContext(
    firstSelectableRoll,
    firstSelectableIndex,
    params.rollStack.length === 1
      ? 'single'
      : firstSelectableIndex === 0 ? 'default-first' : 'first-selectable',
  );
};

export type MoveTimeoutPiece = { id: string; label?: string; nodeId: string; started: boolean; finished: boolean };

export const resolveMoveTimeout = <TPiece extends MoveTimeoutPiece>(params: {
  pieces: TPiece[];
  selectedPieceId?: string | null;
  steps: number;
  canControlPiece: (piece: TPiece) => boolean;
  isSameSidePiece: (piece: TPiece, selected: TPiece) => boolean;
  branchChoice?: BranchChoice;
}): { pieceId: string; branchChoice: BranchChoice; reason: 'selected' | 'deterministic' | 'pass' } => {
  const canMovePiece = (piece: TPiece) => params.steps >= 0 || piece.started;
  const movablePieces = params.pieces.filter((piece) => params.canControlPiece(piece) && !piece.finished && canMovePiece(piece));
  const selectedPiece = movablePieces.find((piece) => piece.id === params.selectedPieceId);
  if (selectedPiece) return { pieceId: selectedPiece.id, branchChoice: params.branchChoice ?? 'outer', reason: 'selected' };
  const grouped = Array.from(new Map(movablePieces.map((piece) => [piece.started ? piece.nodeId : piece.id, piece])).values());
  const deterministic = [...grouped].sort((left, right) => {
    const leftStarted = left.started ? 0 : 1;
    const rightStarted = right.started ? 0 : 1;
    if (leftStarted !== rightStarted) return leftStarted - rightStarted;
    return String(left.label ?? left.id).localeCompare(String(right.label ?? right.id), undefined, { numeric: true });
  })[0];
  return deterministic
    ? { pieceId: deterministic.id, branchChoice: params.branchChoice ?? 'outer', reason: 'deterministic' }
    : { pieceId: '', branchChoice: 'outer', reason: 'pass' };
};

export const resolveItemPromptTimeout = () => ({ useItem: false as const });
export const resolveTrapPlacementTimeout = () => ({ cancelTrapPlacement: true as const });
export const resolveItemPickupTimeout = () => ({ decision: 'keep' as const });
export const resolveGoldenYutTimeout = (): YutResult => {
  const mo = GOLDEN_YUT_CHOICES.find((choice) => choice.name === '모');
  if (!mo) return { name: '모', steps: 5, bonus: true };
  return mo;
};
