import type { SequenceStateSnapshot } from '../../src/app/appState';

const mergePartialSnapshot = (
  snapshot: SequenceStateSnapshot,
  fallback: SequenceStateSnapshot | null,
): SequenceStateSnapshot => {
  if (Array.isArray(snapshot.pieces) || !fallback) return snapshot;
  return { ...fallback, ...snapshot } as SequenceStateSnapshot;
};

export function getAuthoritativeSnapshot(
  value: unknown,
  fallback: SequenceStateSnapshot | null,
): SequenceStateSnapshot | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fallback;
  const record = value as Record<string, unknown>;
  if (record.stateAfter && typeof record.stateAfter === 'object' && !Array.isArray(record.stateAfter)) {
    return mergePartialSnapshot(record.stateAfter as SequenceStateSnapshot, fallback);
  }
  if (record.patch && typeof record.patch === 'object' && !Array.isArray(record.patch)) {
    return mergePartialSnapshot(record.patch as SequenceStateSnapshot, fallback);
  }
  if ('pieces' in record || 'lastSequence' in record || 'turnVersion' in record) {
    return mergePartialSnapshot(record as SequenceStateSnapshot, fallback);
  }
  return fallback;
}
