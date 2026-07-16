import type { CommitAuthoritativeGameActionResult, GameAction } from './roomServiceCore';

type CommittableGameAction = Omit<GameAction, 'id' | 'createdAt' | 'processed'>;
type ActionResultSummary = Pick<CommitAuthoritativeGameActionResult, 'status' | 'reason'>;

export const FALL_PRESENTATION_PENDING_REASON = '낙 결과 표출이 끝난 뒤 다음 차례로 넘어갑니다.';

const AUTOMATED_ROLL_CLIENT_ACTION_PREFIXES = [
  'roll_yut_ai:',
  'roll_timeout:',
] as const;

export const getAutomatedFallPresentationRecoveryAction = (
  action: CommittableGameAction,
  result: ActionResultSummary,
): CommittableGameAction | null => {
  if (action.type !== 'roll_yut'
    || action.payload?.completeFallPresentation === true
    || result.status !== 'rejected'
    || result.reason !== FALL_PRESENTATION_PENDING_REASON) return null;

  const sourceClientActionId = typeof action.payload?.clientActionId === 'string'
    ? action.payload.clientActionId
    : '';
  if (!AUTOMATED_ROLL_CLIENT_ACTION_PREFIXES.some((prefix) => sourceClientActionId.startsWith(prefix))) return null;

  return {
    type: 'roll_yut',
    actorId: action.actorId,
    payload: {
      completeFallPresentation: true,
      recoverySourceClientActionId: sourceClientActionId,
      clientActionId: `complete_fall_presentation_recovery:${sourceClientActionId}`,
    },
  };
};
