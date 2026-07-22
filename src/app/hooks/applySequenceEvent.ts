type SequencePatchState = Record<string, unknown> & {
  lastSequence?: number;
  turnVersion?: number;
  lastClientMutationId?: string;
  logs?: unknown[];
};

type SequenceEventLike = {
  sequence?: number;
  clientMutationId?: string;
  stateAfter?: SequencePatchState | null;
  patch?: SequencePatchState | null;
  payload?: Record<string, unknown>;
  logEntries?: unknown[];
};

type PresentationTimingGrade = 'perfect' | 'nice' | 'good' | 'bad';

const MAX_STORED_LOGS = 200;
const hasOwn = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);

const normalizePresentationTimingGrade = (value: unknown): PresentationTimingGrade | undefined => {
  if (value === 'normal') return 'bad';
  if (value === 'perfect' || value === 'nice' || value === 'good' || value === 'bad') return value;
  return undefined;
};

const withPresentationTimingGrade = (value: unknown, timingGrade: PresentationTimingGrade | undefined) => {
  if (!timingGrade || !value || typeof value !== 'object' || Array.isArray(value)) return value;
  return { ...(value as Record<string, unknown>), presentationTimingGrade: timingGrade };
};

const preserveSequenceRollTimingGrade = (sequence: SequenceEventLike, state: SequencePatchState) => {
  const timingGrade = normalizePresentationTimingGrade(sequence.payload?.timingZone ?? sequence.payload?.rollTimingZone ?? state.lastRollTimingZone);
  if (!timingGrade) return state;
  if (sequence.payload && sequence.payload.displayRoll) {
    sequence.payload.displayRoll = withPresentationTimingGrade(sequence.payload.displayRoll, timingGrade);
  }
  if (!state.roll) return state;
  return { ...state, roll: withPresentationTimingGrade(state.roll, timingGrade) };
};

const getLogKey = (log: unknown) => {
  const id = (log as { id?: unknown } | null)?.id;
  if (typeof id === 'string' || typeof id === 'number') return `id:${String(id)}`;
  try {
    return `value:${JSON.stringify(log)}`;
  } catch {
    return `value:${String(log)}`;
  }
};

export function applySequenceEvent<TState extends SequencePatchState>(state: TState | null | undefined, sequence: SequenceEventLike): TState | null {
  const sequenceNumber = Number(sequence.sequence ?? 0);
  if (!Number.isInteger(sequenceNumber) || sequenceNumber <= 0) return state ?? null;

  const currentSequence = Number(state?.lastSequence ?? 0);
  if (currentSequence >= sequenceNumber) return state ?? null;

  if (sequence.stateAfter) {
    return preserveSequenceRollTimingGrade(sequence, { ...sequence.stateAfter, lastSequence: sequenceNumber }) as TState;
  }

  if (!state || currentSequence !== sequenceNumber - 1) return null;

  const patch = (sequence.patch ?? {}) as SequencePatchState;
  let nextState = { ...state, ...patch, lastSequence: sequenceNumber } as TState;

  if (!hasOwn(patch, 'turnVersion')) {
    nextState.turnVersion = Number(state.turnVersion ?? 0) + 1;
  }
  if (typeof sequence.clientMutationId === 'string' && sequence.clientMutationId) {
    nextState.lastClientMutationId = sequence.clientMutationId;
  }

  const logEntries = Array.isArray(sequence.logEntries) ? sequence.logEntries : [];
  if (logEntries.length) {
    const existingLogs = Array.isArray(state.logs) ? state.logs : [];
    const existingKeys = new Set(existingLogs.map(getLogKey));
    const newLogs = logEntries.filter((log) => {
      const key = getLogKey(log);
      if (existingKeys.has(key)) return false;
      existingKeys.add(key);
      return true;
    });
    nextState.logs = [...newLogs, ...existingLogs].slice(0, MAX_STORED_LOGS);
  } else if (hasOwn(patch, 'logs') && Array.isArray(patch.logs)) {
    nextState.logs = patch.logs;
  }

  nextState = preserveSequenceRollTimingGrade(sequence, nextState) as TState;
  return nextState;
}

export function applySequenceEvents<TState extends SequencePatchState>(baseState: TState | null | undefined, sequences: SequenceEventLike[]): TState | null {
  const orderedSequences = [...sequences].sort((left, right) => Number(left.sequence ?? 0) - Number(right.sequence ?? 0));
  return orderedSequences.reduce<TState | null>((currentState, sequence) => applySequenceEvent(currentState, sequence), baseState ?? null);
}
