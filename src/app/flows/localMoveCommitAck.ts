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

const ACK_METADATA_KEYS = new Set([
  'status', 'sequence', 'turnVersion', 'lastSequence', 'clientMutationId',
  'lastClientMutationId', 'reason', 'payload', 'sequenceEvent',
]);
const hasAuthoritativeStatePayload = (value: unknown) => Boolean(
  value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).some((key) => !ACK_METADATA_KEYS.has(key)),
);

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

/**
 * Metadata-only duplicate ACKs are receipts, not authoritative state.
 * Returning no recovery key keeps the direct recovery branch inert so the
 * existing sequence subscription/replay pipeline remains the single state owner.
 */
export function makeStatelessDuplicateRecoveryKey(_input: StatelessDuplicateRecoveryKeyInput) {
  return '';
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
