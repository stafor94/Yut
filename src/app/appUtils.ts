import type { BoardPiece } from '../features/game/components/GameBoard';
import { BRANCH_NODE_IDS, getMovePathNodeIds, type BranchChoice } from '../game-core/board/board';
import type { YutResult } from '../game-core/roll';
import type { GameLog, PieceCount, PlayMode } from './appState';

const TURN_ORDER_INITIAL_SLOT_SPIN_MS = 3000;
const TURN_ORDER_SLOT_REVEAL_INTERVAL_MS = 2000;
const TURN_ORDER_LAST_SLOT_REVEAL_INTERVAL_MS = 1000;
const ROLL_ANIMATION_MS = 2600;
const ROLL_RESULT_HOLD_GRACE_MS = 1200;

export const getTurnOrderSlotRevealDurationMs = (orderLength: number) => {
  if (orderLength <= 0) return 0;
  if (orderLength === 1) return TURN_ORDER_INITIAL_SLOT_SPIN_MS;
  return TURN_ORDER_INITIAL_SLOT_SPIN_MS + Math.max(0, orderLength - 2) * TURN_ORDER_SLOT_REVEAL_INTERVAL_MS + TURN_ORDER_LAST_SLOT_REVEAL_INTERVAL_MS;
};

export const getTurnOrderStoppedSlotCount = (orderLength: number, elapsedMs: number) => {
  if (orderLength <= 0 || elapsedMs < TURN_ORDER_INITIAL_SLOT_SPIN_MS) return 0;
  if (orderLength === 1) return 1;
  const beforeLastCount = Math.min(orderLength - 1, 1 + Math.floor((elapsedMs - TURN_ORDER_INITIAL_SLOT_SPIN_MS) / TURN_ORDER_SLOT_REVEAL_INTERVAL_MS));
  const lastRevealAt = TURN_ORDER_INITIAL_SLOT_SPIN_MS + Math.max(0, orderLength - 2) * TURN_ORDER_SLOT_REVEAL_INTERVAL_MS + TURN_ORDER_LAST_SLOT_REVEAL_INTERVAL_MS;
  return elapsedMs >= lastRevealAt ? orderLength : beforeLastCount;
};

export const normalizeMaxPlayers = (value: unknown, mode: PlayMode): 2 | 3 | 4 => {
  if (mode === 'team') return 4;
  return value === 2 || value === 3 || value === 4 ? value : 4;
};

export const delay = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));
export const splitMessageBySentence = (message: string) => message.match(/.+?(?:[.!?。]|…+)(?=\s|$)|.+$/g)?.map((sentence) => sentence.trim()).filter(Boolean) ?? [message];

export const normalizeRollResultReadyAt = (readyAt: number, now = Date.now()) => {
  const maxExpectedReadyAt = now + ROLL_ANIMATION_MS + ROLL_RESULT_HOLD_GRACE_MS;
  return readyAt > now && readyAt <= maxExpectedReadyAt ? readyAt : 0;
};

export const hasFinalConsonant = (text: string) => {
  const lastCode = text.charCodeAt(text.length - 1);
  return lastCode >= 0xac00 && lastCode <= 0xd7a3 && (lastCode - 0xac00) % 28 > 0;
};

export const withSubjectParticle = (text: string) => `${text}${hasFinalConsonant(text) ? '이' : '가'}`;
export const withAndParticle = (text: string) => `${text}${hasFinalConsonant(text) ? '과' : '와'}`;
export const formatStoredLogSequence = (log: GameLog, displayIndex?: number) => `#${String(displayIndex ?? log.id).padStart(3, '0')}`;
export type RoomRuleBadge = {
  key: 'mode' | 'players' | 'pieces' | 'items';
  label: string;
  tone: string;
};

export const getRoomRuleBadges = (mode: PlayMode, players: 2 | 3 | 4, pieces: PieceCount, itemsEnabled: boolean): RoomRuleBadge[] => [
  { key: 'mode', label: mode === 'team' ? '팀전' : '개인전', tone: mode === 'team' ? 'team' : 'individual' },
  { key: 'players', label: `${players}인`, tone: 'players' },
  { key: 'pieces', label: mode === 'team' ? `팀별 말 ${pieces}개` : `말 ${pieces}개`, tone: 'pieces' },
  { key: 'items', label: `아이템 ${itemsEnabled ? 'ON' : 'OFF'}`, tone: itemsEnabled ? 'items-on' : 'items-off' },
];

export const formatRoomRuleText = (mode: PlayMode, players: 2 | 3 | 4, pieces: PieceCount, itemsEnabled: boolean) => getRoomRuleBadges(mode, players, pieces, itemsEnabled).map((badge) => badge.label).join(' · ');

export const getEffectiveBranchChoice = (nodeId: string, branchChoice: BranchChoice) => BRANCH_NODE_IDS.includes(nodeId as typeof BRANCH_NODE_IDS[number]) ? branchChoice : 'outer';

export const getMovePreviewNodeIds = (piece: BoardPiece | undefined, result: YutResult | null, branchChoice: BranchChoice) => {
  if (!piece || !result || piece.finished) return [];
  if (result.steps < 0 && !piece.started) return [];
  return getMovePathNodeIds(piece.nodeId, result.steps, getEffectiveBranchChoice(piece.nodeId, branchChoice));
};
