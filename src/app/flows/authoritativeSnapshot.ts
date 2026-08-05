type SnapshotRecord = Record<string, unknown> & {
  pieces?: unknown[];
  stateAfter?: SnapshotRecord | null;
  patch?: SnapshotRecord | null;
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

const isSnapshotRecord = (value: unknown): value is SnapshotRecord => Boolean(
  value && typeof value === 'object' && !Array.isArray(value),
);

export const hasAuthoritativeStatePayload = (value: unknown): value is SnapshotRecord => (
  isSnapshotRecord(value)
  && Object.keys(value).some((key) => !ACK_METADATA_KEYS.has(key))
);

const mergePartialSnapshot = <T extends object>(
  snapshot: SnapshotRecord,
  fallback: T | null,
): T => {
  if (Array.isArray(snapshot.pieces) || !fallback) return snapshot as T;
  return { ...fallback, ...snapshot } as T;
};

export function getAuthoritativeSnapshot<T extends object>(
  value: unknown,
  fallback: T | null,
): T | null {
  if (!isSnapshotRecord(value)) return fallback;
  const record = value as SnapshotRecord;
  if (hasAuthoritativeStatePayload(record.stateAfter)) {
    return mergePartialSnapshot(record.stateAfter, fallback);
  }
  if (hasAuthoritativeStatePayload(record.patch)) {
    return mergePartialSnapshot(record.patch, fallback);
  }
  if (hasAuthoritativeStatePayload(record)) {
    return mergePartialSnapshot(record, fallback);
  }
  return null;
}
