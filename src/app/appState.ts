import type { BoardPiece } from '../features/game/components/GameBoard';
import type { ItemTiming, ItemType } from '../features/items/logic/items';
import type { BoardItem, BranchChoice } from '../game-core/board/board';
import type { RollTimingZone, YutResult, YutStick } from '../game-core/roll';
import type { GameSeatSnapshot, RoomPlayer } from '../features/room/services/roomService';

export type Screen = 'lobby' | 'waitingRoom' | 'game';
export type PlayMode = 'individual' | 'team';
export type Team = '청팀' | '홍팀';
export type PieceCount = 1 | 2 | 3 | 4;

export type Seat = {
  id: string;
  label: string;
  name: string;
  color: string;
  ready: boolean;
  isHost?: boolean;
  isAI?: boolean;
  isSubstitutedByAI?: boolean;
  isEmpty?: boolean;
  isSpectator?: boolean;
  enteredGameAt?: number;
  enteredStartVersion?: number;
  team: Team;
};

export type GameLog = { id: number; text: string };
export type ToastMessage = { id: number; title: string; description?: string; icon?: string };
export type RollAnimation =
  | { id: number; phase: 'primary' | 'extra-spin'; actionKey: string; sticks: YutStick[]; timingZone?: RollTimingZone }
  | { id: number; phase: 'landing' | 'result-hold'; result: YutResult; sticks: YutStick[]; actionKey?: string; fallCount?: number; timingZone?: RollTimingZone }
  | { id: number; phase?: 'resolved'; result: YutResult; sticks: YutStick[]; turnOrder?: boolean; fallCount?: number; timingZone?: RollTimingZone };
export type TurnOrderRoll = { seat: Seat; result: YutResult; rollOffRound: number };
export type TurnOrderPhase = { active: boolean; index: number; rolls: TurnOrderRoll[]; deadline: number; readyAt: number };
export type TurnOrderIntro = { order: { seatId: string; label: string; name: string; color: string }[]; visible: boolean; readyAt: number; slotUntil?: number };
export type CaptureEffect = { id: number; pieceIds: string[] };
export type TrapEffect = { id: number; nodeId: string; pieceIds: string[] };
export type FallEffect = { id: number; seatId: string; timingZone?: RollTimingZone };
export type PendingTrapPlacement = { ownerId: string; pieceId: string; nodeIds: string[]; deadline: number };
export type PendingItemPickup = { seatId: string; item: ItemType; itemId: string; existingItem: ItemType; deadline: number };
export type TrapNode = { nodeId: string; ownerId: string };
export type StalledTurnSyncResolution =
  | { status: 'not-stalled'; reason: string; ageMs: number }
  | { status: 'waiting'; reason: string; ageMs: number; recoveryAfterMs: number }
  | { status: 'recoverable'; reason: string; ageMs: number; recoveryKey: string; pieceId: string }
  | { status: 'blocked'; reason: string; ageMs: number; recoveryKey?: string; pieceId?: string };
export type ManualSyncResolution = StalledTurnSyncResolution & {
  createdAt: number;
  localSequence: number;
  latestSequence: number;
  result: string;
};
export type SequenceStateSnapshot = Partial<{
  pieces: BoardPiece[];
  turnIndex: number;
  turnOrderIds: string[];
  initialTurnOrderIds: string[];
  completedSeatIds: string[];
  rankingSeatIds: string[];
  gameEndMode: 'partial_finish' | 'final' | '';
  lastFinishedSeatId: string;
  continuationRound: number;
  roll: YutResult | null;
  rollStack: YutResult[];
  selectedRollStackIndex: number | null;
  rollStackClosed: boolean;
  boardItems: BoardItem[];
  ownedItems: Record<string, ItemType[]>;
  trapNodes: TrapNode[];
  shieldedPieceIds: string[];
  logs: GameLog[];
  winner: string;
  captureEffect: CaptureEffect | null;
  trapEffect: TrapEffect | null;
  fallEffect: FallEffect | null;
  lastRollTimingZone?: RollTimingZone | null;
  gameStartedAt: number | null;
  turnOrderIntro: TurnOrderIntro | null;
  pendingTrapPlacement: PendingTrapPlacement | null;
  pendingItemPickup?: unknown | null;
  pendingGoldenYutSelection: { actorId: string; deadline: number } | null;
  pendingAfterMoveTurnIndex?: number | null;
  rollLockUntil: number;
  lastMovedPieceIds: string[];
  lastMovedSeatId: string;
  itemPromptTiming: ItemTiming | null;
  branchChoice: BranchChoice;
  rollResultReadyAt: number;
  turnOrderPhase: TurnOrderPhase | null;
  waitingForPlayersReady: boolean;
  turnDeadlineAt: number;
  turnDeadlineKind: 'roll' | 'move' | 'turn_order' | 'item_prompt' | 'trap_placement' | '';
  gameSeats: GameSeatSnapshot[];
  startRequestVersion: number;
  turnVersion: number;
  lastSequence: number;
}>;

export type GameStateFingerprintInput = {
  pieces: BoardPiece[];
  turnIndex: number;
  turnOrderIds: string[];
  initialTurnOrderIds: string[];
  completedSeatIds: string[];
  rankingSeatIds: string[];
  gameEndMode: 'partial_finish' | 'final' | '';
  lastFinishedSeatId: string;
  continuationRound: number;
  roll: YutResult | null;
  rollStack: YutResult[];
  selectedRollStackIndex: number | null;
  rollStackClosed: boolean;
  boardItems: BoardItem[];
  ownedItems: Record<string, ItemType[]>;
  trapNodes: TrapNode[];
  shieldedPieceIds: string[];
  winner: string;
  gameStartedAt: number | null;
  turnOrderIntro: TurnOrderIntro | null;
  pendingTrapPlacement: PendingTrapPlacement | null;
  pendingItemPickup?: unknown | null;
  pendingGoldenYutSelection?: { actorId: string; deadline: number } | null;
  itemPromptTiming?: ItemTiming | null;
  pendingAfterMoveTurnIndex?: number | null;
  rollLockUntil: number;
  lastMovedPieceIds: string[];
  lastMovedSeatId: string;
  effectiveRollResultReadyAt: number;
  turnOrderPhase: TurnOrderPhase | null;
  waitingForPlayersReady: boolean;
  turnDeadlineAt?: number;
  turnDeadlineKind?: 'roll' | 'move' | 'turn_order' | 'item_prompt' | 'trap_placement' | '';
  startRequestVersion: number;
  startRequestId?: string;
  fallEffect?: FallEffect | null;
  lastRollTimingZone?: RollTimingZone | null;
  logs?: GameLog[];
  gameSeats?: GameSeatSnapshot[];
};

export const makeGameStateFingerprint = (state: GameStateFingerprintInput) => JSON.stringify({
  pieces: state.pieces,
  turnIndex: state.turnIndex,
  turnOrderIds: state.turnOrderIds,
  initialTurnOrderIds: state.initialTurnOrderIds,
  completedSeatIds: state.completedSeatIds,
  rankingSeatIds: state.rankingSeatIds,
  gameEndMode: state.gameEndMode,
  lastFinishedSeatId: state.lastFinishedSeatId,
  continuationRound: state.continuationRound,
  roll: state.roll,
  rollStack: state.rollStack,
  selectedRollStackIndex: state.selectedRollStackIndex,
  rollStackClosed: state.rollStackClosed,
  boardItems: state.boardItems,
  ownedItems: state.ownedItems,
  trapNodes: state.trapNodes,
  shieldedPieceIds: state.shieldedPieceIds,
  winner: state.winner,
  gameStartedAt: state.gameStartedAt,
  turnOrderIntro: state.turnOrderIntro,
  pendingTrapPlacement: state.pendingTrapPlacement,
  pendingGoldenYutSelection: state.pendingGoldenYutSelection ?? null,
  itemPromptTiming: state.itemPromptTiming ?? null,
  pendingAfterMoveTurnIndex: state.pendingAfterMoveTurnIndex ?? null,
  rollLockUntil: state.rollLockUntil,
  lastMovedPieceIds: state.lastMovedPieceIds,
  lastMovedSeatId: state.lastMovedSeatId,
  effectiveRollResultReadyAt: state.effectiveRollResultReadyAt,
  turnOrderPhase: state.turnOrderPhase,
  waitingForPlayersReady: state.waitingForPlayersReady,
  turnDeadlineAt: state.turnDeadlineAt ?? 0,
  turnDeadlineKind: state.turnDeadlineKind ?? '',
  startRequestVersion: state.startRequestVersion,
  startRequestId: state.startRequestId ?? '',
  fallEffect: state.fallEffect ?? null,
  lastRollTimingZone: state.lastRollTimingZone ?? null,
  logs: state.logs ?? [],
  gameSeats: state.gameSeats ?? [],
});

export {
  STORAGE_KEYS,
  NICKNAME_MAX_LENGTH,
  RANDOM_NICKNAME_BASES,
  RANDOM_NICKNAME_PREFIXES,
  getInitialNickname,
  getStoredBoolean,
  getStoredNumber,
  getStoredPlayMode,
  getStoredText,
  makeRandomNickname,
  normalizeNickname,
} from './preferences/localPreferences';

export {
  AI_NAME_BASES,
  AI_NAME_PREFIXES,
  PLAYER_COLORS,
  PLAYER_COLOR_LABELS,
  ROOM_COLOR_LABELS,
  TEAM_COLORS,
  createSeats,
  gameSeatSnapshotsFromSeats,
  makePieces,
  preserveLockedGameSeats,
  seatsFromGameSeatSnapshots,
  seatsFromRoomPlayers,
  seatsWithJoinedPlayer,
  spectatorsFromRoomPlayers,
} from './selectors/seatModel';
