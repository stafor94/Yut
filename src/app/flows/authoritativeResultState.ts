import type { SequenceStateSnapshot } from '../appState';

export const getAuthoritativeSnapshot = (
  value: unknown,
  fallback: SequenceStateSnapshot | null,
): SequenceStateSnapshot | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fallback;
  const record = value as Record<string, unknown>;
  if (record.stateAfter && typeof record.stateAfter === 'object' && !Array.isArray(record.stateAfter)) {
    return record.stateAfter as SequenceStateSnapshot;
  }
  if (record.patch && typeof record.patch === 'object' && !Array.isArray(record.patch) && fallback) {
    return { ...fallback, ...(record.patch as SequenceStateSnapshot) };
  }
  if ('pieces' in record || 'lastSequence' in record || 'turnVersion' in record) {
    return record as SequenceStateSnapshot;
  }
  return fallback;
};

export const primeAuthoritativeResultState = (
  value: unknown,
  fallback: SequenceStateSnapshot | null,
  assign: (state: SequenceStateSnapshot) => void,
) => {
  const state = getAuthoritativeSnapshot(value, fallback);
  if (state) assign(state);
  return state;
};
