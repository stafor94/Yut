export type TurnActionFeedbackLevel = 'status' | 'recoverable' | 'critical';

const TRANSIENT_ACTION_BLOCK_REASONS = new Set([
  'waiting-for-turn-order',
  'turn-order-phase-active',
  'turn-order-intro-active',
  'moving-piece',
  'pending-trap-placement',
  'pending-item-prompt',
  'pending-item-pickup',
  'saving-game-state',
  'pending-local-remote-action',
  'processing-remote-action',
  'roll-in-progress',
  'roll-locked',
]);

const GUIDANCE_ACTION_BLOCK_REASONS = new Set([
  'no-active-seat',
  'not-local-turn',
  'ai-turn',
  'spectator',
  'winner',
  'roll-already-exists',
  'roll-required',
  'movable-piece-required',
]);

export function classifyTurnActionFeedback(reasons: string[]): TurnActionFeedbackLevel {
  if (!reasons.length) return 'recoverable';
  if (reasons.every((reason) => TRANSIENT_ACTION_BLOCK_REASONS.has(reason))) return 'status';
  if (reasons.every((reason) => TRANSIENT_ACTION_BLOCK_REASONS.has(reason) || GUIDANCE_ACTION_BLOCK_REASONS.has(reason))) return 'recoverable';
  return 'critical';
}

export function shouldOpenTurnActionErrorDialog(kind: 'blocked' | 'failure', reasons: string[] = []) {
  if (kind === 'blocked') return false;
  if (!reasons.length) return true;
  return classifyTurnActionFeedback(reasons) === 'critical';
}

export function shouldClearActionErrorDialog(params: {
  dialogOpenedRoomId: string;
  currentRoomId: string;
  dialogOpenedSequence: number;
  currentSequence: number;
  dialogOpenedTurnIndex: number;
  currentTurnIndex: number;
}) {
  if (params.dialogOpenedRoomId !== params.currentRoomId) return true;
  if (params.currentSequence > params.dialogOpenedSequence) return true;
  return params.currentTurnIndex !== params.dialogOpenedTurnIndex;
}
