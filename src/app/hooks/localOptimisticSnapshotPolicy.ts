type LocalOptimisticSnapshotPolicyInput = {
  hasPendingLocalMove: boolean;
  localSequence: number;
  remoteSequence: number;
};

export function shouldDeferSameOrOlderSnapshotForPendingLocalMove({
  hasPendingLocalMove,
  localSequence,
  remoteSequence,
}: LocalOptimisticSnapshotPolicyInput) {
  if (!hasPendingLocalMove) return false;
  const normalizedLocalSequence = Number.isFinite(localSequence) ? localSequence : 0;
  const normalizedRemoteSequence = Number.isFinite(remoteSequence) ? remoteSequence : 0;
  return normalizedRemoteSequence <= normalizedLocalSequence;
}
