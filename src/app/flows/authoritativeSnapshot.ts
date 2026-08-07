import {
  clearStackedMoveSelectionIdentityContext,
  publishAuthoritativeStackedMoveContext,
} from '../../features/room/services/stackedMoveSelectionIdentity';

type SnapshotRecord = Record<string, unknown> & {
  pieces?: unknown[];
  stateAfter?: SnapshotRecord | null;
  patch?: SnapshotRecord | null;
};

const mergePartialSnapshot = <T extends object>(
  snapshot: SnapshotRecord,
  fallback: T | null,
): T => {
  if (Array.isArray(snapshot.pieces) || !fallback) return snapshot as T;
  return { ...fallback, ...snapshot } as T;
};

const publishResolvedSnapshot = <T extends object>(snapshot: T | null) => {
  if (snapshot) publishAuthoritativeStackedMoveContext(snapshot);
  return snapshot;
};

export function getAuthoritativeSnapshot<T extends object>(
  value: unknown,
  fallback: T | null,
): T | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    if (!fallback) clearStackedMoveSelectionIdentityContext();
    return publishResolvedSnapshot(fallback);
  }
  const record = value as SnapshotRecord;
  if (record.stateAfter && typeof record.stateAfter === 'object' && !Array.isArray(record.stateAfter)) {
    return publishResolvedSnapshot(mergePartialSnapshot(record.stateAfter, fallback));
  }
  if (record.patch && typeof record.patch === 'object' && !Array.isArray(record.patch)) {
    return publishResolvedSnapshot(mergePartialSnapshot(record.patch, fallback));
  }
  if ('pieces' in record || 'lastSequence' in record || 'turnVersion' in record) {
    return publishResolvedSnapshot(mergePartialSnapshot(record, fallback));
  }
  return publishResolvedSnapshot(fallback);
}
