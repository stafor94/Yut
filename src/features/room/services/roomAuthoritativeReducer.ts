import { rollYutResult, type YutResult } from '../../../game-core/roll';
import { reduceMoveCommand, reduceRollCommand, type EngineState } from '../../../game-core/gameEngine';
import type { BranchChoice } from '../../../game-core/board/board';
import type { GameAction, GameStatePatch, RoomPlayer, RoomSummary, SyncedGameState } from './roomService';

export type AuthoritativeActionResult = { status: 'committed' | 'duplicate' | 'rejected' | 'unsupported'; sequence?: number; turnVersion?: number; reason?: string; patch?: GameStatePatch; payload?: Record<string, unknown> };
type AuthoritativeCommitReduction = { status: 'committed'; patch: GameStatePatch; payload: Record<string, unknown> };
export type AuthoritativeReduction = AuthoritativeCommitReduction | Exclude<AuthoritativeActionResult, { status: 'committed' }>;
export const isAuthoritativeCommitReduction = (reduction: AuthoritativeReduction): reduction is AuthoritativeCommitReduction => 'patch' in reduction;
type AuthoritativePiece = { id: string; ownerId: string; label?: string; nodeIndex: number; nodeId: string; started: boolean; finished: boolean; color?: string };
type AuthoritativeLog = { id: number; text: string };
type AuthoritativeTrapNode = { nodeId: string; ownerId: string };
export type AuthoritativeSeatSide = { id: string; team: RoomPlayer['team'] };

const getNextLogId = (logs: unknown[]) => logs.reduce<number>((maxId, log) => {
  if (log && typeof log === 'object' && 'id' in log) return Math.max(maxId, Number((log as { id?: unknown }).id) || 0);
  return maxId;
}, 0) + 1;
const makeAuthoritativeLog = (logs: unknown[], text: string): AuthoritativeLog => ({ id: getNextLogId(logs), text });
const getAuthoritativeRoll = (payload: Record<string, unknown> | undefined) => {
  const forcedResult = payload?.forcedResult as YutResult | null | undefined;
  return forcedResult ?? rollYutResult().result;
};
const makeActionReject = (reason: string): AuthoritativeActionResult => ({ status: 'rejected', reason });
const getActionActorLogName = (action: Omit<GameAction, 'id' | 'createdAt' | 'processed'>) => {
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

function makeEngineState(state: SyncedGameState): EngineState {
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
    boardItems: state.boardItems ?? [],
    ownedItems: state.ownedItems as Record<string, never[]> | undefined,
  };
}

function toAuthoritativeReduction(reduction: ReturnType<typeof reduceRollCommand> | ReturnType<typeof reduceMoveCommand>): AuthoritativeReduction {
  if (!reduction.ok) return makeActionReject(reduction.message);
  return { status: 'committed' as const, patch: reduction.patch as GameStatePatch, payload: reduction.payload };
}

function reduceAuthoritativeRoll(state: SyncedGameState, action: Omit<GameAction, 'id' | 'createdAt' | 'processed'>): AuthoritativeReduction {
  const nextRoll = getAuthoritativeRoll(action.payload);
  return toAuthoritativeReduction(reduceRollCommand({
    state: makeEngineState(state),
    actorId: action.actorId,
    nextRoll,
    actorLogName: getActionActorLogName(action),
    rollResultReadyAt: Date.now() + 2600,
    makeLog: makeAuthoritativeLog,
  }));
}
function reduceAuthoritativeMove(state: SyncedGameState, action: Omit<GameAction, 'id' | 'createdAt' | 'processed'>, room: Omit<RoomSummary, 'id'>, sides: AuthoritativeSeatSide[]): AuthoritativeReduction {
  const baseReduction = toAuthoritativeReduction(reduceMoveCommand({
    state: makeEngineState(state),
    actorId: action.actorId,
    pieceId: String(action.payload?.pieceId ?? ''),
    branchChoice: (action.payload?.branchChoice as BranchChoice | undefined) ?? 'outer',
    extraSteps: Number(action.payload?.extraSteps ?? 0),
    actorLogName: getActionActorLogName(action),
    playMode: room.playMode,
    sides,
    makeLog: makeAuthoritativeLog,
  }));
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

function reduceContinueRace(state: SyncedGameState, action: Omit<GameAction, 'id' | 'createdAt' | 'processed'>, room: Omit<RoomSummary, 'id'>): AuthoritativeReduction {
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

export function reduceAuthoritativeGameAction(state: SyncedGameState, action: Omit<GameAction, 'id' | 'createdAt' | 'processed'>, room: Omit<RoomSummary, 'id'>, sides: AuthoritativeSeatSide[] = []): AuthoritativeReduction {
  if (action.type === 'roll_yut') return reduceAuthoritativeRoll(state, action);
  if (action.type === 'move_piece') return reduceAuthoritativeMove(state, action, room, sides);
  if (action.type === 'continue_race') return reduceContinueRace(state, action, room);
  return { status: 'unsupported' };
}

