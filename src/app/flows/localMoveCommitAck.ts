type LocalMoveCommitAckInput = {
  actionType: string;
  actionKey: string;
  ownsLocalMove: boolean;
  status: unknown;
  sequence: unknown;
};

type LocalMovePendingReleaseInput = {
  localPresentationCompleted: boolean;
  serverSequenceAcked: boolean;
  fingerprintMatched: boolean | null;
};

export function shouldConsumeLocalMoveCommitAck({
  actionType,
  actionKey,
  ownsLocalMove,
  status,
  sequence,
}: LocalMoveCommitAckInput) {
  const sequenceNumber = Number(sequence ?? 0);
  return actionType === 'move_piece'
    && Boolean(actionKey)
    && ownsLocalMove
    && (status === 'committed' || status === 'duplicate')
    && Number.isFinite(sequenceNumber)
    && sequenceNumber > 0;
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
