import {
  canRoll as canRollFromCore,
  getRollActionBlockReasons as getRollActionBlockReasonsFromCore,
  getTurnActionBlockReasons as getTurnActionBlockReasonsFromCore,
  type RollGuardInput,
  type TurnActionGuardInput,
} from './gameEngineCore';
import { isPendingStackedBonusRoll } from './stackedRollTurnGuard';

export * from './gameEngineCore';

export const PENDING_STACKED_BONUS_ROLL_REASON = 'pending-stacked-bonus-roll';

export function getTurnActionBlockReasons(input: TurnActionGuardInput) {
  const reasons = getTurnActionBlockReasonsFromCore(input);
  if (!isPendingStackedBonusRoll() || reasons.includes(PENDING_STACKED_BONUS_ROLL_REASON)) return reasons;
  return [...reasons, PENDING_STACKED_BONUS_ROLL_REASON];
}

export function getRollActionBlockReasons(input: RollGuardInput) {
  return getRollActionBlockReasonsFromCore(input);
}

export function canSubmitTurnAction(input: TurnActionGuardInput) {
  return getTurnActionBlockReasons(input).length === 0;
}

export function canRoll(input: RollGuardInput) {
  return canRollFromCore(input);
}
