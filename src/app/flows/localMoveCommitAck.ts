import { hasAuthoritativeStatePayload } from './authoritativeSnapshot';

type LocalMoveCommitAckInput = {
  actionType: string;
  actionKey: string;
  ownsLocalMove: boolean;
  status: unknown;
  sequence: unknown;
  stateAfter?: unknown;
  patch?: unknown;
};

type LocalMovePendingReleaseInput = {
  localPresentationCompleted: boolean;
  serverSequenceAcked: boolean;
  fingerprintMatched: boolean | null;
};

type StatelessDuplicateRecoveryKeyInput = {
  roomId: string;
  actionKey: string;
  sequence: unknown;
};

export type LocalMoveCommitAckClassification = 'stateful' | 'stateless-duplicate' | 'passthrough';

export function classifyLocalMoveCommitAck({
  actionType,
  actionKey,
  ownsLocalMove,
  status,
  sequence,
  stateAfter,
  patch,
}: LocalMoveCommitAckInput): LocalMoveCommitAckClassification {
  const sequenceNumber = Number(sequence ?? 0);
  const ownedMoveResult = actionType === 'move_piece'
    && Boolean(actionKey)
    && ownsLocalMove
    && Number.isFinite(sequenceNumber)
    && sequenceNumber > 0;
  if (!ownedMoveResult) return 'passthrough';

  const hasState = hasAuthoritativeStatePayload(stateAfter) || hasAuthoritativeStatePayload(patch);
  if ((status === 'committed' || status === 'duplicate') && hasState) return 'stateful';
  if (status === 'duplicate' && !hasState) return 'stateless-duplicate';
  return 'passthrough';
}

export function shouldConsumeLocalMoveCommitAck(input: LocalMoveCommitAckInput) {
  return classifyLocalMoveCommitAck(input) === 'stateful';
}

export function makeStatelessDuplicateRecoveryKey({
  roomId,
  actionKey,
  sequence,
}: StatelessDuplicateRecoveryKeyInput) {
  const sequenceNumber = Number(sequence ?? 0);
  if (!roomId || !actionKey || !Number.isFinite(sequenceNumber) || sequenceNumber <= 0) return '';
  return `${roomId}:${actionKey}:${Math.trunc(sequenceNumber)}`;
}

export function shouldReleaseLocalMovePending({
  localPresentationCompleted,
  serverSequenceAcked,
  fingerprintMatched,
}: LocalMovePendingReleaseInput) {
  return localPresentationCompleted
    && serverSequenceAcked
    && fingerprintMatched === true;
}
