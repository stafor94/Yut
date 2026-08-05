type SnapshotRecord = Record<string, unknown> & {
  stateAfter?: unknown;
  patch?: unknown;
};

const ACK_METADATA_KEYS = new Set([
  'status',
  'sequence',
  'turnVersion',
  'lastSequence',
  'clientMutationId',
  'lastClientMutationId',
  'reason',
  'payload',
  'sequenceEvent',
]);

const isRecord = (value: unknown): value is SnapshotRecord => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const hasStatePayload = (value: unknown): value is SnapshotRecord => (
  isRecord(value) && Object.keys(value).some((key) => !ACK_METADATA_KEYS.has(key))
);

const cloneObjectValue = (value: unknown) => isRecord(value) ? { ...value } : value;

const cloneArrayValue = (value: unknown) => Array.isArray(value)
  ? value.map((entry) => cloneObjectValue(entry))
  : value;

const normalizeAppliedSnapshot = (appliedValue: unknown): SnapshotRecord | null => {
  if (!isRecord(appliedValue)) return null;
  const appliedState = hasStatePayload(appliedValue.stateAfter)
    ? appliedValue.stateAfter
    : hasStatePayload(appliedValue.patch)
      ? appliedValue.patch
      : hasStatePayload(appliedValue)
        ? appliedValue
        : null;
  if (!appliedState) return null;
  const appliedSequence = Number(appliedValue.sequence ?? appliedState.lastSequence ?? 0);
  return {
    ...appliedState,
    ...(appliedSequence ? { lastSequence: appliedSequence } : {}),
  };
};

const getAppliedOrLatestValue = (appliedSnapshot: SnapshotRecord, latestRecord: SnapshotRecord, key: string) => (
  Object.prototype.hasOwnProperty.call(appliedSnapshot, key) ? appliedSnapshot[key] : latestRecord[key]
);

export const shouldApplyAuthoritativeWake = ({
  roomMatches,
  appliedSequence,
  lastAppliedSequence,
  deferred,
}: {
  roomMatches: boolean;
  appliedSequence: number;
  lastAppliedSequence: number;
  deferred: boolean;
}) => Boolean(
  roomMatches
  && appliedSequence > 0
  && appliedSequence > lastAppliedSequence
  && !deferred
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
