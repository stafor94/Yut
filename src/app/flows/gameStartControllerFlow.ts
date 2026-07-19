export const INITIAL_GAME_SYNCED_STATE_KEYS = [
  'pieces', 'turnIndex', 'turnOrderIds', 'initialTurnOrderIds', 'completedSeatIds', 'rankingSeatIds', 'gameEndMode',
  'lastFinishedSeatId', 'continuationRound', 'roll', 'rollStack', 'selectedRollStackIndex', 'rollStackClosed', 'boardItems',
  'ownedItems', 'trapNodes', 'shieldedPieceIds', 'logs', 'winner', 'captureEffect', 'trapEffect', 'fallEffect', 'gameStartedAt',
  'turnOrderIntro', 'pendingTrapPlacement', 'rollLockUntil', 'lastMovedPieceIds', 'lastMovedSeatId', 'itemPromptTiming',
  'branchChoice', 'rollResultReadyAt', 'turnOrderPhase', 'waitingForPlayersReady', 'turnDeadlineAt', 'turnDeadlineKind',
  'gameSeats', 'startRequestVersion', 'startRequestId',
] as const;

export function listInitialGameSyncedStateKeys(state: Record<string, unknown>) {
  return INITIAL_GAME_SYNCED_STATE_KEYS.filter((key) => Object.prototype.hasOwnProperty.call(state, key));
}

export function createInitialGameSyncedStateShape(input: {
  pieces: unknown[];
  turnOrderIds: string[];
  boardItems: unknown[];
  logs: Array<{ id: number; text: string }>;
  gameStartedAt: number;
  turnOrderIntro: unknown;
  turnOrderPhase: { active: boolean; index: number; rolls: unknown[]; deadline: number; readyAt: number };
  turnDeadlineAt: number;
  gameSeats: unknown[];
  startRequestVersion: number;
  startRequestId: string;
}) {
  return {
    pieces: input.pieces,
    turnIndex: 0,
    turnOrderIds: input.turnOrderIds,
    initialTurnOrderIds: input.turnOrderIds,
    completedSeatIds: [],
    rankingSeatIds: [],
    gameEndMode: '' as const,
    lastFinishedSeatId: '',
    continuationRound: 0,
    roll: null,
    rollStack: [],
    selectedRollStackIndex: null,
    rollStackClosed: false,
    boardItems: input.boardItems,
    ownedItems: {},
    trapNodes: [],
    shieldedPieceIds: [],
    logs: input.logs,
    winner: '',
    captureEffect: null,
    trapEffect: null,
    fallEffect: null,
    gameStartedAt: input.gameStartedAt,
    turnOrderIntro: input.turnOrderIntro,
    pendingTrapPlacement: null,
    rollLockUntil: 0,
    lastMovedPieceIds: [],
    lastMovedSeatId: '',
    itemPromptTiming: null,
    branchChoice: 'outer',
    rollResultReadyAt: 0,
    turnOrderPhase: input.turnOrderPhase,
    waitingForPlayersReady: false,
    turnDeadlineAt: input.turnDeadlineAt,
    turnDeadlineKind: 'roll' as const,
    gameSeats: input.gameSeats,
    startRequestVersion: input.startRequestVersion,
    startRequestId: input.startRequestId,
  };
}
