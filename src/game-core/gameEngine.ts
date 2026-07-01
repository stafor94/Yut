import { BOARD_NODES, getMovePathNodeIds, type BranchChoice } from './board/board';
import type { YutResult } from './roll';

export type GameCommandType = 'roll_yut' | 'move_piece';

export type GameErrorCode =
  | 'NO_TURN_ORDER'
  | 'NOT_YOUR_TURN'
  | 'GAME_ALREADY_FINISHED'
  | 'TURN_ORDER_PHASE_ACTIVE'
  | 'TURN_ORDER_INTRO_ACTIVE'
  | 'PENDING_TRAP_PLACEMENT'
  | 'ROLL_ALREADY_EXISTS'
  | 'ROLL_REQUIRED'
  | 'MOVABLE_PIECE_REQUIRED';

export type GameCommandRejection = { ok: false; code: GameErrorCode; message: string };
export type GameCommandCommit<TPatch extends Record<string, unknown> = Record<string, unknown>, TPayload extends Record<string, unknown> = Record<string, unknown>> = { ok: true; patch: TPatch; payload: TPayload };
export type GameCommandResult<TPatch extends Record<string, unknown> = Record<string, unknown>, TPayload extends Record<string, unknown> = Record<string, unknown>> = GameCommandCommit<TPatch, TPayload> | GameCommandRejection;

export type EngineLog = { id: number; text: string };
export type EnginePiece = { id: string; ownerId: string; label?: string; nodeIndex: number; nodeId: string; started: boolean; finished: boolean; color?: string };
export type EngineTrapNode = { nodeId: string; ownerId: string };
export type EngineSeatSide = { id: string; team?: string };

export type EngineState = {
  pieces: EnginePiece[];
  turnIndex: number;
  turnOrderIds: string[];
  roll: YutResult | null;
  logs: EngineLog[];
  winner: string;
  turnOrderPhase?: { active?: boolean } | null;
  turnOrderIntro?: { readyAt?: unknown } | null;
  pendingTrapPlacement?: unknown | null;
  trapNodes: EngineTrapNode[];
  shieldedPieceIds: string[];
  branchChoice?: BranchChoice;
};

export type TurnActionGuardInput = {
  activeSeatId?: string;
  actorId: string;
  isActorAI?: boolean;
  isSpectator?: boolean;
  winner?: string;
  turnOrderPhaseActive?: boolean;
  turnOrderIntroActive?: boolean;
  movingPieceId?: string;
  pendingTrapPlacement?: boolean;
  pendingHostStateSave?: boolean;
};

export type RollGuardInput = TurnActionGuardInput & {
  roll?: YutResult | null;
  rollLocked?: boolean;
  remoteActionClient?: boolean;
  rollInProgress?: boolean;
  pendingLocalRemoteActionCount?: number;
  processingActionCount?: number;
};

export function getTurnActionBlockReasons(input: TurnActionGuardInput) {
  return [
    !input.activeSeatId ? 'no-active-seat' : '',
    input.activeSeatId && input.activeSeatId !== input.actorId ? 'not-local-turn' : '',
    input.isActorAI ? 'ai-turn' : '',
    input.isSpectator ? 'spectator' : '',
    input.winner ? 'winner' : '',
    input.turnOrderPhaseActive ? 'turn-order-phase-active' : '',
    input.turnOrderIntroActive ? 'turn-order-intro-active' : '',
    input.movingPieceId ? 'moving-piece' : '',
    input.pendingTrapPlacement ? 'pending-trap-placement' : '',
    input.pendingHostStateSave ? 'saving-host-state' : '',
  ].filter(Boolean);
}

export function getRollActionBlockReasons(input: RollGuardInput) {
  return [
    ...getTurnActionBlockReasons(input),
    input.roll ? 'roll-already-exists' : '',
    input.rollLocked ? 'roll-locked' : '',
    !input.remoteActionClient && input.rollInProgress ? 'roll-in-progress' : '',
    (input.pendingLocalRemoteActionCount ?? 0) > 0 ? 'pending-local-remote-action' : '',
    (input.processingActionCount ?? 0) > 0 ? 'processing-remote-action' : '',
  ].filter(Boolean);
}

export function canSubmitTurnAction(input: TurnActionGuardInput) {
  return getTurnActionBlockReasons(input).length === 0;
}

export function canRoll(input: RollGuardInput) {
  return getRollActionBlockReasons(input).length === 0;
}

export function getGameErrorMessage(code: string) {
  const messages: Record<string, string> = {
    NO_TURN_ORDER: '아직 차례 순서가 정해지지 않았습니다.',
    NOT_YOUR_TURN: '지금은 내 차례가 아닙니다.',
    GAME_ALREADY_FINISHED: '이미 종료된 게임입니다.',
    TURN_ORDER_PHASE_ACTIVE: '차례 순서를 정하는 중입니다.',
    TURN_ORDER_INTRO_ACTIVE: '차례 순서 안내가 끝난 뒤 진행해주세요.',
    PENDING_TRAP_PLACEMENT: '함정 설치 선택이 먼저 필요합니다.',
    ROLL_ALREADY_EXISTS: '이미 윷을 던졌습니다. 말을 이동해주세요.',
    ROLL_REQUIRED: '먼저 윷을 던져주세요.',
    MOVABLE_PIECE_REQUIRED: '이동할 수 있는 말을 선택해주세요.',
  };
  return messages[code] ?? '게임 액션을 처리할 수 없습니다.';
}

const reject = (code: GameErrorCode): GameCommandRejection => ({ ok: false, code, message: getGameErrorMessage(code) });
const isTurnOrderIntroActive = (intro: EngineState['turnOrderIntro'], now = Date.now()) => {
  if (!intro || typeof intro !== 'object' || !('readyAt' in intro)) return false;
  return Number((intro as { readyAt?: unknown }).readyAt ?? 0) > now;
};
const getActiveActorId = (state: EngineState) => state.turnOrderIds[Number(state.turnIndex ?? 0) % Math.max(state.turnOrderIds.length, 1)];
const validateCommonTurnCommand = (state: EngineState, actorId: string, options: { requireRoll?: boolean; requireNoRoll?: boolean } = {}) => {
  if (!state.turnOrderIds.length) return reject('NO_TURN_ORDER');
  if (getActiveActorId(state) !== actorId) return reject('NOT_YOUR_TURN');
  if (state.winner) return reject('GAME_ALREADY_FINISHED');
  if (state.turnOrderPhase?.active) return reject('TURN_ORDER_PHASE_ACTIVE');
  if (isTurnOrderIntroActive(state.turnOrderIntro)) return reject('TURN_ORDER_INTRO_ACTIVE');
  if (state.pendingTrapPlacement) return reject('PENDING_TRAP_PLACEMENT');
  if (options.requireNoRoll && state.roll) return reject('ROLL_ALREADY_EXISTS');
  if (options.requireRoll && !state.roll) return reject('ROLL_REQUIRED');
  return null;
};

export function reduceRollCommand(params: { state: EngineState; actorId: string; nextRoll: YutResult; actorLogName: string; rollResultReadyAt: number; makeLog: (logs: EngineLog[], text: string) => EngineLog }): GameCommandResult {
  const { state, actorId, nextRoll, actorLogName, rollResultReadyAt, makeLog } = params;
  const blocked = validateCommonTurnCommand(state, actorId, { requireNoRoll: true });
  if (blocked) return blocked;
  return {
    ok: true,
    patch: {
      roll: nextRoll,
      rollResultReadyAt,
      shieldedPieceIds: [],
      logs: [makeLog(state.logs ?? [], `${actorLogName}이(가) ${nextRoll.name}(${nextRoll.steps}칸)를 던졌습니다.`), ...(state.logs ?? [])],
    },
    payload: { activeSeatId: actorId, rollName: nextRoll.name, steps: nextRoll.steps },
  };
}

const isSameSide = (leftId: string, rightId: string, playMode: string, sides: EngineSeatSide[]) => {
  if (playMode !== 'team') return leftId === rightId;
  const left = sides.find((side) => side.id === leftId);
  const right = sides.find((side) => side.id === rightId);
  return Boolean(left && right && left.team === right.team);
};
const canControlPiece = (actorId: string, piece: EnginePiece | undefined, playMode: string, sides: EngineSeatSide[]) => Boolean(piece && isSameSide(actorId, piece.ownerId, playMode, sides));

export function reduceMoveCommand(params: { state: EngineState; actorId: string; pieceId: string; branchChoice: BranchChoice; extraSteps?: number; actorLogName: string; playMode: string; sides: EngineSeatSide[]; makeLog: (logs: EngineLog[], text: string) => EngineLog }): GameCommandResult {
  const { state, actorId, pieceId, branchChoice, extraSteps = 0, actorLogName, playMode, sides, makeLog } = params;
  const blocked = validateCommonTurnCommand(state, actorId, { requireRoll: true });
  if (blocked) return blocked;

  const result = state.roll as YutResult;
  const pieces = [...state.pieces];
  const movingPiece = pieces.find((piece) => piece.id === pieceId && !piece.finished && canControlPiece(actorId, piece, playMode, sides));
  const steps = result.steps + extraSteps;
  const nextLogs = [...(state.logs ?? [])];
  const pushLog = (text: string) => nextLogs.unshift(makeLog(nextLogs, text));
  const advanceTurnPatch = (extra: Record<string, unknown>) => ({ roll: null, branchChoice: 'outer', turnIndex: (Number(state.turnIndex ?? 0) + 1) % state.turnOrderIds.length, logs: nextLogs, lastMovedSeatId: actorId, ...extra });

  if (!movingPiece) {
    if (steps < 0) {
      pushLog(`${actorLogName}은(는) 판 위에 나온 말이 없어 빽도를 이동하지 못합니다.`);
      return { ok: true, patch: advanceTurnPatch({ lastMovedPieceIds: [] }), payload: { activeSeatId: actorId, pieceId, skipped: true } };
    }
    return reject('MOVABLE_PIECE_REQUIRED');
  }
  if (steps < 0 && !movingPiece.started) {
    pushLog(`${actorLogName}은(는) 판 위에 나온 말이 없어 빽도를 이동하지 못합니다.`);
    return { ok: true, patch: advanceTurnPatch({ lastMovedPieceIds: [] }), payload: { activeSeatId: actorId, pieceId, skipped: true } };
  }
  if (steps === 0) {
    pushLog(`${actorLogName} 말은 이동할 칸 수가 없어 제자리에 머뭅니다.`);
    return { ok: true, patch: advanceTurnPatch({ lastMovedPieceIds: [movingPiece.id] }), payload: { activeSeatId: actorId, pieceId, stayed: true } };
  }

  const movingGroupIds = movingPiece.started
    ? pieces.filter((piece) => piece.started && !piece.finished && piece.nodeId === movingPiece.nodeId && canControlPiece(actorId, piece, playMode, sides)).map((piece) => piece.id)
    : [movingPiece.id];
  const movePathNodeIds = getMovePathNodeIds(movingPiece.nodeId, steps, branchChoice);
  let currentNodeId = movingPiece.nodeId;
  let currentNodeIndex = movingPiece.nodeIndex;
  let finishedMove = false;
  for (let step = 0; step < Math.abs(steps); step += 1) {
    const nextNodeId = movePathNodeIds[step];
    if (!nextNodeId || (steps < 0 && nextNodeId === 'n01' && currentNodeId === 'n02')) {
      currentNodeId = 'finish';
      currentNodeIndex = 20;
      finishedMove = true;
      break;
    }
    currentNodeId = nextNodeId;
    currentNodeIndex = Math.max(0, BOARD_NODES.findIndex((node) => node.id === nextNodeId));
  }

  const nextPieces = pieces.map((piece) => movingGroupIds.includes(piece.id)
    ? { ...piece, nodeId: currentNodeId, nodeIndex: currentNodeIndex, started: currentNodeId !== 'finish', finished: currentNodeId === 'finish' }
    : piece);
  let nextTrapNodes = [...(state.trapNodes ?? [])];
  let nextShieldedPieceIds = [...(state.shieldedPieceIds ?? [])];
  let captured = false;

  const steppedOnTrap = nextTrapNodes.find((trap) => trap.nodeId === currentNodeId && !isSameSide(trap.ownerId, actorId, playMode, sides));
  if (steppedOnTrap) {
    nextTrapNodes = nextTrapNodes.filter((trap) => trap !== steppedOnTrap);
    const shieldedFromTrap = movingGroupIds.some((id) => nextShieldedPieceIds.includes(id));
    if (shieldedFromTrap) {
      nextShieldedPieceIds = nextShieldedPieceIds.filter((id) => !movingGroupIds.includes(id));
      pushLog(`${actorLogName} 말이 방패로 함정을 막았습니다.`);
    } else {
      nextPieces.forEach((piece) => {
        if (movingGroupIds.includes(piece.id)) {
          piece.nodeIndex = 0; piece.nodeId = 'n01'; piece.started = false; piece.finished = false;
        }
      });
      currentNodeId = 'n01';
      pushLog(`${actorLogName} 말이 함정을 밟아 시작점으로 돌아갑니다.`);
    }
  }

  if (currentNodeId !== 'finish') {
    const capturedPieceIds = nextPieces
      .filter((piece) => !movingGroupIds.includes(piece.id) && piece.started && !piece.finished && piece.nodeId === currentNodeId && !isSameSide(piece.ownerId, actorId, playMode, sides) && !nextShieldedPieceIds.includes(piece.id))
      .map((piece) => piece.id);
    if (capturedPieceIds.length) {
      captured = true;
      nextPieces.forEach((piece) => {
        if (capturedPieceIds.includes(piece.id)) {
          piece.nodeIndex = 0; piece.nodeId = 'n01'; piece.started = false; piece.finished = false;
        }
      });
      const capturedOwnerCounts = capturedPieceIds.reduce<Record<string, number>>((counts, capturedPieceId) => {
        const ownerId = nextPieces.find((piece) => piece.id === capturedPieceId)?.ownerId ?? '';
        if (!ownerId) return counts;
        counts[ownerId] = (counts[ownerId] ?? 0) + 1;
        return counts;
      }, {});
      Object.entries(capturedOwnerCounts).forEach(([ownerId, count]) => pushLog(`${actorLogName}이(가) ${ownerId}의 말 ${count}개를 잡았습니다.`));
      pushLog('상대 말을 잡아 한 번 더 던질 수 있습니다.');
    }
  }

  if (movingGroupIds.length > 1) pushLog(`${actorLogName}의 말 ${movingGroupIds.length}개가 업혀 함께 이동합니다.`);
  if (finishedMove) pushLog(`${actorLogName} 말이 완주했습니다!`);
  const nextTurnIndex = result.bonus || captured ? Number(state.turnIndex ?? 0) : (Number(state.turnIndex ?? 0) + 1) % state.turnOrderIds.length;

  return {
    ok: true,
    patch: {
      pieces: nextPieces,
      turnIndex: nextTurnIndex,
      roll: null,
      trapNodes: nextTrapNodes,
      shieldedPieceIds: nextShieldedPieceIds,
      logs: nextLogs,
      lastMovedPieceIds: movingGroupIds,
      lastMovedSeatId: actorId,
      branchChoice: 'outer',
      rollResultReadyAt: 0,
    },
    payload: { activeSeatId: actorId, pieceId, movingGroupIds, captured, finishedMove },
  };
}
