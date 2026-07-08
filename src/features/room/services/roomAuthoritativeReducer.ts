import { rollYutResultWithTiming, type RollTimingZone, type YutResult } from '../../../game-core/roll';
import { reduceMoveCommand, reduceRollCommand, type EngineState } from '../../../game-core/gameEngine';
import { ITEM_DEFINITIONS, type ItemType } from '../../items/logic/items';
import { getNearbyNodeIds, type BranchChoice } from '../../../game-core/board/board';

type GameStatePatch = Record<string, unknown>;
type RoomPlayerTeam = '청팀' | '홍팀';
type RoomSummaryShape = { playMode: 'individual' | 'team'; pieceCount?: 1 | 2 | 3 | 4; stackedRollMode?: boolean };
type SyncedGameStateShape = {
  pieces: unknown[];
  turnIndex: number;
  turnOrderIds?: string[];
  initialTurnOrderIds?: string[];
  completedSeatIds?: string[];
  rankingSeatIds?: string[];
  gameEndMode?: 'partial_finish' | 'final' | '';
  lastFinishedSeatId?: string;
  continuationRound?: number;
  roll: unknown | null;
  rollStack?: unknown[];
  selectedRollStackIndex?: number | null;
  rollStackClosed?: boolean;
  boardItems?: unknown[];
  trapNodes?: unknown[];
  shieldedPieceIds?: string[];
  logs: unknown[];
  winner: string;
  turnOrderPhase?: unknown;
  turnOrderIntro?: unknown;
  pendingTrapPlacement?: unknown;
  turnDeadlineAt?: number;
  turnDeadlineKind?: 'roll' | 'move' | 'turn_order' | 'item_prompt' | 'trap_placement' | '';
  itemPromptTiming?: unknown;
  pendingAfterMoveTurnIndex?: number;
  lastMovedPieceIds?: string[];
  lastMovedSeatId?: string;
  branchChoice?: unknown;
  rollResultReadyAt?: number;
  ownedItems?: unknown;
  fallEffect?: unknown;
  lastRollTimingZone?: unknown;
};
type GameActionShape = { id: string; type: 'turn_order_roll' | 'roll_yut' | 'move_piece' | 'continue_race' | 'use_item' | 'place_trap'; actorId: string; payload?: Record<string, unknown>; createdAt?: unknown; processed?: boolean };
export type AuthoritativeActionResult = { status: 'committed' | 'duplicate' | 'rejected' | 'unsupported'; sequence?: number; turnVersion?: number; reason?: string; patch?: GameStatePatch; payload?: Record<string, unknown> };
type AuthoritativeCommitReduction = { status: 'committed'; patch: GameStatePatch; payload: Record<string, unknown> };
export type AuthoritativeReduction = AuthoritativeCommitReduction | Exclude<AuthoritativeActionResult, { status: 'committed' }>;
export const isAuthoritativeCommitReduction = (reduction: AuthoritativeReduction): reduction is AuthoritativeCommitReduction => 'patch' in reduction;
type AuthoritativePiece = { id: string; ownerId: string; label?: string; nodeIndex: number; nodeId: string; started: boolean; finished: boolean; color?: string };
type AuthoritativeLog = { id: number; text: string };
type AuthoritativeTrapNode = { nodeId: string; ownerId: string };
type AuthoritativePendingTrapPlacement = { ownerId?: string; pieceId?: string; nodeIds?: string[]; nextTurnIndex?: number; deadline?: number };
export type AuthoritativeSeatSide = { id: string; team: RoomPlayerTeam };
const TURN_ACTION_TIMEOUT_MS = 15000;

const getNextLogId = (logs: unknown[]) => logs.reduce<number>((maxId, log) => {
  if (log && typeof log === 'object' && 'id' in log) return Math.max(maxId, Number((log as { id?: unknown }).id) || 0);
  return maxId;
}, 0) + 1;
const makeAuthoritativeLog = (logs: unknown[], text: string): AuthoritativeLog => ({ id: getNextLogId(logs), text });
const getAuthoritativeRoll = (payload: Record<string, unknown> | undefined) => {
  const forcedResult = payload?.forcedResult as YutResult | null | undefined;
  const timingZone = (payload?.rollTimingZone as RollTimingZone | undefined) ?? 'normal';
  return forcedResult ?? rollYutResultWithTiming(timingZone).result;
};
const makeActionReject = (reason: string): AuthoritativeActionResult => ({ status: 'rejected', reason });
const getActionActorLogName = (action: Omit<GameActionShape, 'id' | 'createdAt' | 'processed'>) => {
  const actorLogName = action.payload?.actorLogName;
  const actorLabel = action.payload?.actorLabel;
  const actorName = action.payload?.actorName;
  if (typeof actorLogName === 'string' && actorLogName.trim()) return actorLogName.trim();
  if (typeof actorLabel === 'string' && typeof actorName === 'string' && actorLabel.trim() && actorName.trim()) return `${actorLabel.trim()}-${actorName.trim()}`;
  if (typeof actorName === 'string' && actorName.trim()) return actorName.trim();
  if (typeof actorLabel === 'string' && actorLabel.trim()) return actorLabel.trim();
  return action.actorId;
};
const normalizeSeatIds = (ids: unknown[] | undefined) => (ids ?? []).map(String).filter(Boolean);
const getCompletedIndividualSeatIds = (pieces: AuthoritativePiece[], seatIds: string[], pieceCount: number) => seatIds.filter((seatId) => {
  const seatPieces = pieces.filter((piece) => piece.ownerId === seatId);
  return seatPieces.length >= pieceCount && seatPieces.every((piece) => piece.finished);
});
const getUnfinishedSeatIds = (seatIds: string[], completedSeatIds: string[]) => seatIds.filter((seatId) => !completedSeatIds.includes(seatId));
const appendUnique = (ids: string[], nextIds: string[]) => [...ids, ...nextIds.filter((id) => id && !ids.includes(id))];
const isSameAuthoritativeSide = (leftId: string, rightId: string, playMode: RoomSummaryShape['playMode'], sides: AuthoritativeSeatSide[]) => {
  if (playMode !== 'team') return leftId === rightId;
  const left = sides.find((side) => side.id === leftId);
  const right = sides.find((side) => side.id === rightId);
  return Boolean(left && right && left.team === right.team);
};
const canActorControlAuthoritativePiece = (actorId: string, piece: AuthoritativePiece | undefined, room: RoomSummaryShape, sides: AuthoritativeSeatSide[]) => Boolean(piece && isSameAuthoritativeSide(actorId, piece.ownerId, room.playMode, sides));
const getAfterMovePromptPatch = (state: SyncedGameStateShape, basePatch: GameStatePatch, actorId: string, nextTurnIndex: number, room: RoomSummaryShape, sides: AuthoritativeSeatSide[]) => {
  const nextOwnedItems = (basePatch.ownedItems ?? state.ownedItems ?? {}) as Record<string, ItemType[]>;
  const lastMovedPieceIds = ((basePatch.lastMovedPieceIds as string[] | undefined) ?? state.lastMovedPieceIds ?? []);
  const hasAfterMoveItem = (nextOwnedItems[actorId] ?? []).some((type) => ITEM_DEFINITIONS[type]?.timing === 'after_move');
  const nextPieces = (basePatch.pieces as AuthoritativePiece[] | undefined) ?? (state.pieces as AuthoritativePiece[]);
  const hasMovedPieceOnBoard = lastMovedPieceIds.some((pieceId) => nextPieces.some((piece) => piece.id === pieceId && piece.started && !piece.finished && canActorControlAuthoritativePiece(actorId, piece, room, sides)));
  if (!hasAfterMoveItem || !hasMovedPieceOnBoard) return null;
  return { turnIndex: Number(state.turnIndex ?? 0), turnDeadlineAt: Date.now() + TURN_ACTION_TIMEOUT_MS, turnDeadlineKind: 'item_prompt' as const, itemPromptTiming: 'after_move' as const, pendingAfterMoveTurnIndex: nextTurnIndex };
};

function makeEngineState(state: SyncedGameStateShape): EngineState {
  return {
    pieces: state.pieces as AuthoritativePiece[],
    turnIndex: Number(state.turnIndex ?? 0),
    turnOrderIds: state.turnOrderIds ?? [],
    roll: (state.roll as YutResult | null | undefined) ?? null,
    logs: (state.logs as AuthoritativeLog[] | undefined) ?? [],
    winner: state.winner ?? '',
    turnOrderPhase: state.turnOrderPhase as { active?: boolean } | null | undefined,
    turnOrderIntro: state.turnOrderIntro as { readyAt?: unknown } | null | undefined,
    pendingTrapPlacement: state.pendingTrapPlacement,
    trapNodes: (state.trapNodes as AuthoritativeTrapNode[] | undefined) ?? [],
    shieldedPieceIds: state.shieldedPieceIds ?? [],
    branchChoice: (state.branchChoice as BranchChoice | undefined) ?? 'outer',
    boardItems: (state.boardItems as EngineState['boardItems'] | undefined) ?? [],
    ownedItems: state.ownedItems as Record<string, never[]> | undefined,
    fallEffect: state.fallEffect as EngineState['fallEffect'],
  };
}

function toAuthoritativeReduction(reduction: ReturnType<typeof reduceRollCommand> | ReturnType<typeof reduceMoveCommand>): AuthoritativeReduction {
  if (!reduction.ok) return makeActionReject(reduction.message);
  return { status: 'committed' as const, patch: reduction.patch as GameStatePatch, payload: reduction.payload };
}

function reduceAuthoritativeRoll(state: SyncedGameStateShape, action: Omit<GameActionShape, 'id' | 'createdAt' | 'processed'>, room: RoomSummaryShape): AuthoritativeReduction {
  if (room.stackedRollMode && state.rollStackClosed === true) {
    return makeActionReject('이미 윷을 던졌습니다. 말을 이동해주세요.');
  }
  const nextRoll = getAuthoritativeRoll(action.payload);
  const now = Date.now();
  const baseReduction = toAuthoritativeReduction(reduceRollCommand({
    state: makeEngineState({ ...state, roll: room.stackedRollMode ? null : state.roll }),
    actorId: action.actorId,
    nextRoll,
    actorLogName: getActionActorLogName(action),
    rollResultReadyAt: now + 2600,
    makeLog: makeAuthoritativeLog,
    fallOccurred: Boolean(action.payload?.fallOccurred),
    timingZone: action.payload?.rollTimingZone as RollTimingZone | undefined,
  }));
  if (isAuthoritativeCommitReduction(baseReduction)) {
    const fallOccurred = Boolean(action.payload?.fallOccurred);
    baseReduction.patch = {
      ...baseReduction.patch,
      turnDeadlineAt: fallOccurred ? now + TURN_ACTION_TIMEOUT_MS : now + 2600 + TURN_ACTION_TIMEOUT_MS,
      turnDeadlineKind: fallOccurred ? 'roll' : 'move',
    };
    baseReduction.payload = {
      ...baseReduction.payload,
      timedOut: Boolean(action.payload?.timedOut),
      timeoutRecoveredBy: action.payload?.timeoutRecoveredBy ?? null,
    };
  }
  if (!isAuthoritativeCommitReduction(baseReduction) || !room.stackedRollMode) return baseReduction;
  if (action.payload?.fallOccurred) {
    return { ...baseReduction, patch: { ...baseReduction.patch, rollStack: [], selectedRollStackIndex: null, rollStackClosed: false } };
  }
  const currentStack = ((state.rollStack as YutResult[] | undefined) ?? []);
  const nextStack = [...currentStack, nextRoll];
  return {
    ...baseReduction,
    patch: {
      ...baseReduction.patch,
      roll: null,
      rollStack: nextStack,
      selectedRollStackIndex: null,
      rollStackClosed: !nextRoll.bonus,
    },
    payload: { ...baseReduction.payload, rollStack: nextStack, rollStackClosed: !nextRoll.bonus },
  };
}
function reduceAuthoritativeMove(state: SyncedGameStateShape, action: Omit<GameActionShape, 'id' | 'createdAt' | 'processed'>, room: RoomSummaryShape, sides: AuthoritativeSeatSide[]): AuthoritativeReduction {
  const rollStack = ((state.rollStack as YutResult[] | undefined) ?? []);
  const rollStackIndex = typeof action.payload?.rollStackIndex === 'number' ? Number(action.payload.rollStackIndex) : null;
  const stackedRoll = room.stackedRollMode && rollStackIndex !== null ? rollStack[rollStackIndex] : null;
  if (room.stackedRollMode && rollStack.length > 0 && !stackedRoll) return makeActionReject('선택한 이동 스택을 찾을 수 없습니다.');
  const baseReduction = toAuthoritativeReduction(reduceMoveCommand({
    state: makeEngineState(stackedRoll ? { ...state, roll: stackedRoll } : state),
    actorId: action.actorId,
    pieceId: String(action.payload?.pieceId ?? ''),
    branchChoice: (action.payload?.branchChoice as BranchChoice | undefined) ?? 'outer',
    extraSteps: Number(action.payload?.extraSteps ?? 0),
    actorLogName: getActionActorLogName(action),
    playMode: room.playMode,
    sides,
    makeLog: makeAuthoritativeLog,
  }));
  if (isAuthoritativeCommitReduction(baseReduction)) {
    baseReduction.patch = {
      ...baseReduction.patch,
      turnDeadlineAt: Date.now() + TURN_ACTION_TIMEOUT_MS,
      turnDeadlineKind: 'roll',
    };
    baseReduction.payload = {
      ...baseReduction.payload,
      timedOut: Boolean(action.payload?.timedOut),
      timeoutRecoveredBy: action.payload?.timeoutRecoveredBy ?? null,
    };
  }
  if (isAuthoritativeCommitReduction(baseReduction) && room.stackedRollMode && rollStackIndex !== null) {
    const remainingRollStack = rollStack.filter((_, index) => index !== rollStackIndex);
    const captured = Boolean(baseReduction.payload?.captured);
    const shouldAdvanceTurn = remainingRollStack.length === 0 && !captured;
    const nextTurnIndex = shouldAdvanceTurn ? (Number(state.turnIndex ?? 0) + 1) % Math.max((state.turnOrderIds ?? []).length, 1) : Number(state.turnIndex ?? 0);
    const afterMovePromptPatch = shouldAdvanceTurn ? getAfterMovePromptPatch(state, baseReduction.patch, action.actorId, nextTurnIndex, room, sides) : null;
    baseReduction.patch = {
      ...baseReduction.patch,
      turnIndex: nextTurnIndex,
      roll: null,
      rollStack: remainingRollStack,
      selectedRollStackIndex: !captured && remainingRollStack.length === 1 ? 0 : null,
      rollStackClosed: captured ? false : remainingRollStack.length > 0,
      rollResultReadyAt: 0,
      ...afterMovePromptPatch,
    };
    baseReduction.payload = {
      ...baseReduction.payload,
      rollStackIndex,
      remainingRollStack,
      nextTurnIndex,
      extraTurn: !shouldAdvanceTurn,
    };
  }

  if (isAuthoritativeCommitReduction(baseReduction) && !(room.stackedRollMode && rollStackIndex !== null)) {
    const movedTurnIndex = Number(baseReduction.patch.turnIndex ?? state.turnIndex ?? 0);
    const didAdvanceTurn = movedTurnIndex !== Number(state.turnIndex ?? 0);
    const afterMovePromptPatch = didAdvanceTurn ? getAfterMovePromptPatch(state, baseReduction.patch, action.actorId, movedTurnIndex, room, sides) : null;
    if (afterMovePromptPatch) baseReduction.patch = { ...baseReduction.patch, ...afterMovePromptPatch };
  }

  if (!isAuthoritativeCommitReduction(baseReduction) || room.playMode !== 'individual') return baseReduction;

  const nextPieces = (baseReduction.patch.pieces as AuthoritativePiece[] | undefined) ?? (state.pieces as AuthoritativePiece[]);
  const activeSeatIds = normalizeSeatIds(state.initialTurnOrderIds?.length ? state.initialTurnOrderIds : state.turnOrderIds);
  const configuredPieceCount = Number(room.pieceCount ?? 4);
  const previousCompletedSeatIds = normalizeSeatIds(state.completedSeatIds);
  const completedSeatIds = getCompletedIndividualSeatIds(nextPieces, activeSeatIds, configuredPieceCount);
  const newlyCompletedSeatIds = completedSeatIds.filter((seatId) => !previousCompletedSeatIds.includes(seatId));
  if (!newlyCompletedSeatIds.includes(action.actorId)) return baseReduction;

  const nextCompletedSeatIds = appendUnique(previousCompletedSeatIds, newlyCompletedSeatIds);
  const nextRankingSeatIds = appendUnique(normalizeSeatIds(state.rankingSeatIds), newlyCompletedSeatIds);
  const unfinishedSeatIds = getUnfinishedSeatIds(activeSeatIds, nextCompletedSeatIds);
  const isContinuationEligibleGame = activeSeatIds.length >= 3;
  const canContinueRace = isContinuationEligibleGame && unfinishedSeatIds.length >= 2;
  const actorLogName = getActionActorLogName(action);
  const nextLogs = (baseReduction.patch.logs as AuthoritativeLog[] | undefined) ?? ((state.logs as AuthoritativeLog[] | undefined) ?? []);
  const rankNumber = nextRankingSeatIds.indexOf(action.actorId) + 1;
  const rankLog = makeAuthoritativeLog(nextLogs, `${actorLogName}님이 ${rankNumber > 0 ? `${rankNumber}위로 ` : ''}완주했습니다.`);

  return {
    status: 'committed',
    patch: {
      ...baseReduction.patch,
      logs: [rankLog, ...nextLogs],
      completedSeatIds: nextCompletedSeatIds,
      rankingSeatIds: nextRankingSeatIds,
      initialTurnOrderIds: activeSeatIds,
      lastFinishedSeatId: action.actorId,
      gameEndMode: canContinueRace ? 'partial_finish' : 'final',
      winner: `${actorLogName} 승리`,
    },
    payload: {
      ...baseReduction.payload,
      completedSeatIds: nextCompletedSeatIds,
      rankingSeatIds: nextRankingSeatIds,
      unfinishedSeatIds,
      gameEndMode: canContinueRace ? 'partial_finish' : 'final',
    },
  };
}


const removeOneItem = (ownedItems: unknown, ownerId: string, itemType: ItemType) => {
  const currentOwnedItems = { ...((ownedItems ?? {}) as Record<string, ItemType[]>) };
  const currentItems = [...(currentOwnedItems[ownerId] ?? [])];
  const itemIndex = currentItems.indexOf(itemType);
  if (itemIndex < 0) return null;
  currentItems.splice(itemIndex, 1);
  return { ...currentOwnedItems, [ownerId]: currentItems };
};
const getSelectedStackIndex = (state: SyncedGameStateShape) => {
  if (typeof state.selectedRollStackIndex === 'number') return state.selectedRollStackIndex;
  const stack = (state.rollStack as YutResult[] | undefined) ?? [];
  if (!stack.length || !state.roll) return null;
  const currentRoll = state.roll as YutResult;
  const index = stack.findIndex((roll) => roll.name === currentRoll.name && roll.steps === currentRoll.steps && Boolean(roll.bonus) === Boolean(currentRoll.bonus));
  return index >= 0 ? index : null;
};
const makeAuthoritativeTrapCandidateNodeIds = (nodeId: string) => getNearbyNodeIds(nodeId, 1).filter((candidateNodeId) => candidateNodeId !== 'n01');

function reduceUseItem(state: SyncedGameStateShape, action: Omit<GameActionShape, 'id' | 'createdAt' | 'processed'>, room: RoomSummaryShape, sides: AuthoritativeSeatSide[]): AuthoritativeReduction {
  const itemType = action.payload?.itemType as ItemType | undefined;
  if (!itemType || !ITEM_DEFINITIONS[itemType]) return makeActionReject('사용할 아이템을 찾을 수 없습니다.');
  const itemTiming = ITEM_DEFINITIONS[itemType].timing;
  if (itemTiming === 'after_move') {
    if (state.lastMovedSeatId !== action.actorId) return makeActionReject('방금 이동한 플레이어만 사용할 수 있습니다.');
  } else if ((state.turnOrderIds ?? [])[Number(state.turnIndex ?? 0)] !== action.actorId) return makeActionReject('지금은 내 차례가 아닙니다.');
  const nextOwnedItems = removeOneItem(state.ownedItems, action.actorId, itemType);
  if (!nextOwnedItems) return makeActionReject('보유한 아이템이 없습니다.');
  const now = Date.now();
  const logs = (state.logs as AuthoritativeLog[] | undefined) ?? [];
  const actorLogName = getActionActorLogName(action);

  if (itemType === 'reroll') {
    const replacementRoll = (action.payload?.replacementRoll as YutResult | undefined) ?? getAuthoritativeRoll(action.payload);
    if (room.stackedRollMode) {
      const currentStack = [...(((state.rollStack as YutResult[] | undefined) ?? []))];
      const stackIndex = typeof action.payload?.rollStackIndex === 'number' ? Number(action.payload.rollStackIndex) : getSelectedStackIndex(state);
      if (stackIndex === null || stackIndex < 0 || stackIndex >= currentStack.length) return makeActionReject('교체할 이동 스택을 찾을 수 없습니다.');
      currentStack[stackIndex] = replacementRoll;
      return {
        status: 'committed',
        patch: {
          ownedItems: nextOwnedItems,
          roll: replacementRoll,
          rollStack: currentStack,
          selectedRollStackIndex: stackIndex,
          rollStackClosed: !replacementRoll.bonus,
          rollResultReadyAt: now + 2600,
          turnDeadlineAt: now + 2600 + TURN_ACTION_TIMEOUT_MS,
          turnDeadlineKind: 'move',
          itemPromptTiming: null,
          logs: [makeAuthoritativeLog(logs, `${actorLogName}님이 다시 던지기로 ${replacementRoll.name}(${replacementRoll.steps}칸)를 다시 냈습니다.`), ...logs],
        },
        payload: { activeSeatId: action.actorId, itemType, replacementRoll, rollStack: currentStack, rollStackIndex: stackIndex },
      };
    }
    if (!state.roll) return makeActionReject('교체할 윷 결과가 없습니다.');
    return {
      status: 'committed',
      patch: {
        ownedItems: nextOwnedItems,
        roll: replacementRoll,
        rollResultReadyAt: now + 2600,
        turnDeadlineAt: now + 2600 + TURN_ACTION_TIMEOUT_MS,
        turnDeadlineKind: 'move',
        itemPromptTiming: null,
        logs: [makeAuthoritativeLog(logs, `${actorLogName}님이 다시 던지기로 ${replacementRoll.name}(${replacementRoll.steps}칸)를 다시 냈습니다.`), ...logs],
      },
      payload: { activeSeatId: action.actorId, itemType, replacementRoll },
    };
  }

  if (itemType === 'trap') {
    const lastMovedPieceIds = state.lastMovedPieceIds ?? [];
    const pieceId = String(action.payload?.pieceId ?? lastMovedPieceIds[0] ?? '');
    const piece = (state.pieces as AuthoritativePiece[]).find((entry) => entry.id === pieceId && entry.started && !entry.finished && canActorControlAuthoritativePiece(action.actorId, entry, room, sides));
    if (state.lastMovedSeatId !== action.actorId || !piece || !lastMovedPieceIds.includes(piece.id)) return makeActionReject('함정을 설치할 말을 찾을 수 없습니다.');
    const nodeIds = makeAuthoritativeTrapCandidateNodeIds(piece.nodeId);
    if (!nodeIds.length) return makeActionReject('함정을 설치할 수 있는 칸이 없습니다.');
    return {
      status: 'committed',
      patch: {
        pendingTrapPlacement: { ownerId: action.actorId, pieceId: piece.id, nodeIds, nextTurnIndex: Number((state as { pendingAfterMoveTurnIndex?: unknown }).pendingAfterMoveTurnIndex ?? state.turnIndex ?? 0), deadline: now + 10000 },
        itemPromptTiming: null,
        turnDeadlineAt: now + 10000,
        turnDeadlineKind: 'trap_placement',
      },
      payload: { activeSeatId: action.actorId, itemType, pieceId: piece.id, nodeIds },
    };
  }

  return makeActionReject('아직 온라인 authoritative 처리 대상이 아닌 아이템입니다.');
}

function reducePlaceTrap(state: SyncedGameStateShape, action: Omit<GameActionShape, 'id' | 'createdAt' | 'processed'>, room: RoomSummaryShape, sides: AuthoritativeSeatSide[]): AuthoritativeReduction {
  const placement = state.pendingTrapPlacement as AuthoritativePendingTrapPlacement | null | undefined;
  const nodeId = String(action.payload?.nodeId ?? '');
  const pieceId = String(action.payload?.pieceId ?? placement?.pieceId ?? '');
  if (!placement || placement.ownerId !== action.actorId || placement.pieceId !== pieceId || !placement.nodeIds?.includes(nodeId)) return makeActionReject('함정 설치 위치가 유효하지 않습니다.');
  const nextOwnedItems = removeOneItem(state.ownedItems, action.actorId, 'trap');
  if (!nextOwnedItems) return makeActionReject('보유한 함정 아이템이 없습니다.');
  const piece = (state.pieces as AuthoritativePiece[]).find((entry) => entry.id === pieceId && entry.started && !entry.finished && canActorControlAuthoritativePiece(action.actorId, entry, room, sides));
  if (!piece) return makeActionReject('함정을 설치할 말을 찾을 수 없습니다.');
  const logs = (state.logs as AuthoritativeLog[] | undefined) ?? [];
  const nextTrapNodes = [...(((state.trapNodes as AuthoritativeTrapNode[] | undefined) ?? []).filter((trap) => trap.nodeId !== nodeId)), { nodeId, ownerId: action.actorId }];
  return {
    status: 'committed',
    patch: {
      ownedItems: nextOwnedItems,
      trapNodes: nextTrapNodes,
      pendingTrapPlacement: null,
      itemPromptTiming: null,
      turnIndex: typeof placement.nextTurnIndex === 'number' ? placement.nextTurnIndex : Number(state.turnIndex ?? 0),
      turnDeadlineAt: Date.now() + TURN_ACTION_TIMEOUT_MS,
      turnDeadlineKind: 'roll',
      logs: [makeAuthoritativeLog(logs, `${getActionActorLogName(action)}님이 ${piece.label ?? piece.id} 주변 ${nodeId} 칸에 함정을 설치했습니다.`), ...logs],
    },
    payload: { activeSeatId: action.actorId, nodeId, pieceId, trapNodes: nextTrapNodes },
  };
}

function reduceContinueRace(state: SyncedGameStateShape, action: Omit<GameActionShape, 'id' | 'createdAt' | 'processed'>, room: RoomSummaryShape): AuthoritativeReduction {
  if (room.playMode !== 'individual') return makeActionReject('개인전에서만 이어서 진행할 수 있습니다.');
  if (state.gameEndMode !== 'partial_finish') return makeActionReject('이어서 진행할 수 있는 종료 상태가 아닙니다.');
  const activeSeatIds = normalizeSeatIds(state.initialTurnOrderIds?.length ? state.initialTurnOrderIds : state.turnOrderIds);
  if (activeSeatIds.length < 3) return makeActionReject('3인 이상 개인전에서만 이어서 진행할 수 있습니다.');
  const pieces = state.pieces as AuthoritativePiece[];
  const completedSeatIds = normalizeSeatIds(state.completedSeatIds).length
    ? normalizeSeatIds(state.completedSeatIds)
    : getCompletedIndividualSeatIds(pieces, activeSeatIds, Number(room.pieceCount ?? 4));
  const unfinishedSeatIds = getUnfinishedSeatIds(activeSeatIds, completedSeatIds);
  if (unfinishedSeatIds.length < 2) return makeActionReject('이어서 진행할 플레이어가 부족합니다.');
  const previousLogs = (state.logs as AuthoritativeLog[] | undefined) ?? [];
  const nextRound = Number(state.continuationRound ?? 0) + 1;
  const nextLogs = [makeAuthoritativeLog(previousLogs, `완주하지 못한 ${unfinishedSeatIds.length}명이 이어서 진행합니다.`), ...previousLogs];
  return {
    status: 'committed',
    patch: {
      winner: '',
      gameEndMode: '',
      lastFinishedSeatId: '',
      turnOrderIds: unfinishedSeatIds,
      turnIndex: 0,
      roll: null,
      rollAnimation: null,
      rollResultReadyAt: 0,
      rollLockUntil: 0,
      captureEffect: null,
      trapEffect: null,
      pendingTrapPlacement: null,
      itemPromptTiming: null,
      branchChoice: 'outer',
      lastMovedPieceIds: [],
      lastMovedSeatId: '',
      logs: nextLogs,
      completedSeatIds,
      initialTurnOrderIds: activeSeatIds,
      continuationRound: nextRound,
    },
    payload: { unfinishedSeatIds, completedSeatIds, continuationRound: nextRound },
  };
}

export function reduceAuthoritativeGameAction(state: SyncedGameStateShape, action: Omit<GameActionShape, 'id' | 'createdAt' | 'processed'>, room: RoomSummaryShape, sides: AuthoritativeSeatSide[] = []): AuthoritativeReduction {
  if (action.type === 'roll_yut') return reduceAuthoritativeRoll(state, action, room);
  if (action.type === 'move_piece') return reduceAuthoritativeMove(state, action, room, sides);
  if (action.type === 'continue_race') return reduceContinueRace(state, action, room);
  if (action.type === 'use_item') return reduceUseItem(state, action, room, sides);
  if (action.type === 'place_trap') return reducePlaceTrap(state, action, room, sides);
  return { status: 'unsupported' };
}
