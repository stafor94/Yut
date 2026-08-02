type SnapshotRecord = Record<string, unknown> & {
  pieces?: unknown[];
  stateAfter?: SnapshotRecord | null;
  patch?: SnapshotRecord | null;
};

const mergePartialSnapshot = <T extends SnapshotRecord>(
  snapshot: SnapshotRecord,
  fallback: T | null,
): T => {
  if (Array.isArray(snapshot.pieces) || !fallback) return snapshot as T;
  return { ...fallback, ...snapshot } as T;
};

export function getAuthoritativeSnapshot<T extends SnapshotRecord>(
  value: unknown,
  fallback: T | null,
): T | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fallback;
  const record = value as SnapshotRecord;
  if (record.stateAfter && typeof record.stateAfter === 'object' && !Array.isArray(record.stateAfter)) {
    return mergePartialSnapshot(record.stateAfter, fallback);
  }
  if (record.patch && typeof record.patch === 'object' && !Array.isArray(record.patch)) {
    return mergePartialSnapshot(record.patch, fallback);
  }
  if ('pieces' in record || 'lastSequence' in record || 'turnVersion' in record) {
    return mergePartialSnapshot(record, fallback);
  }
  return fallback;
}
