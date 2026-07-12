type SequencePatchState = Record<string, unknown> & { lastSequence?: number; logs?: unknown[] };
type SequenceEventLike = {
  sequence?: number;
  stateAfter?: SequencePatchState | null;
  patch?: SequencePatchState | null;
  logEntries?: unknown[];
};

const MAX_STORED_LOGS = 200;
const hasOwn = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);
const getLogId = (log: unknown) => Number((log as { id?: unknown } | null)?.id);

export function applySequenceEvent<TState extends SequencePatchState>(state: TState | null | undefined, sequence: SequenceEventLike): TState | null {
  const sequenceNumber = Number(sequence.sequence ?? 0);
  if (!sequenceNumber) return state ?? null;
  const currentSequence = Number(state?.lastSequence ?? 0);
  if (currentSequence >= sequenceNumber) return state ?? null;
  if (sequence.stateAfter) return { ...sequence.stateAfter, lastSequence: sequenceNumber } as TState;
  if (!state || currentSequence !== sequenceNumber - 1) return null;
  const patch = (sequence.patch ?? {}) as SequencePatchState;
  const nextState = { ...state, ...patch, lastSequence: sequenceNumber } as TState;
  const logEntries = Array.isArray(sequence.logEntries) ? sequence.logEntries : [];
  if (logEntries.length) {
    const existingLogs = Array.isArray(state.logs) ? state.logs : [];
    const existingIds = new Set(existingLogs.map(getLogId));
    const newLogs = logEntries.filter((log) => !existingIds.has(getLogId(log)));
    nextState.logs = [...newLogs, ...existingLogs].slice(0, MAX_STORED_LOGS);
  } else if (hasOwn(patch, 'logs') && Array.isArray(patch.logs)) {
    nextState.logs = patch.logs;
  }
  return nextState;
}

export function applySequenceEvents<TState extends SequencePatchState>(baseState: TState | null | undefined, sequences: SequenceEventLike[]): TState | null {
  return sequences.reduce<TState | null>((currentState, sequence) => applySequenceEvent(currentState, sequence), baseState ?? null);
}
