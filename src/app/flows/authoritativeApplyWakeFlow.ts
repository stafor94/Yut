type SnapshotRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is SnapshotRecord => Boolean(value && typeof value === 'object' && !Array.isArray(value));

const cloneObjectValue = (value: unknown) => isRecord(value) ? { ...value } : value;

const cloneArrayValue = (value: unknown) => Array.isArray(value)
  ? value.map((entry) => cloneObjectValue(entry))
  : value;

const normalizeAppliedSnapshot = (appliedValue: unknown): SnapshotRecord | null => {
  if (!isRecord(appliedValue)) return null;
  const appliedState = isRecord(appliedValue.stateAfter)
    ? appliedValue.stateAfter
    : isRecord(appliedValue.patch)
      ? appliedValue.patch
      : appliedValue;
  const appliedSequence = Number(appliedValue.sequence ?? appliedState.lastSequence ?? 0);
  return {
    ...appliedState,
    ...(appliedSequence ? { lastSequence: appliedSequence } : {}),
  };
};

const getAppliedOrLatestValue = (appliedSnapshot: SnapshotRecord, latestRecord: SnapshotRecord, key: string) => (
  Object.prototype.hasOwnProperty.call(appliedSnapshot, key) ? appliedSnapshot[key] : latestRecord[key]
);

export function buildAuthoritativeApplyWakeSnapshot<TSnapshot extends object>(
  appliedValue: unknown,
  latestSnapshot: TSnapshot | null,
): TSnapshot | null {
  const appliedSnapshot = normalizeAppliedSnapshot(appliedValue);
  if (!appliedSnapshot) return null;

  const latestRecord = (latestSnapshot ?? {}) as SnapshotRecord;
  const mergedSnapshot = { ...latestRecord, ...appliedSnapshot };
  const startRequestVersion = Number(appliedSnapshot.startRequestVersion ?? 0) || Number(latestRecord.startRequestVersion ?? 0);
  const startRequestId = String(appliedSnapshot.startRequestId ?? '') || String(latestRecord.startRequestId ?? '');
  const pieces = cloneArrayValue(getAppliedOrLatestValue(appliedSnapshot, latestRecord, 'pieces'));
  const gameSeats = cloneArrayValue(getAppliedOrLatestValue(appliedSnapshot, latestRecord, 'gameSeats'));
  const roll = cloneObjectValue(getAppliedOrLatestValue(appliedSnapshot, latestRecord, 'roll'));
  const rollStack = cloneArrayValue(getAppliedOrLatestValue(appliedSnapshot, latestRecord, 'rollStack'));

  return {
    ...mergedSnapshot,
    ...(startRequestVersion ? { startRequestVersion } : {}),
    ...(startRequestId ? { startRequestId } : {}),
    pieces,
    gameSeats,
    roll,
    rollStack,
  } as TSnapshot;
}
