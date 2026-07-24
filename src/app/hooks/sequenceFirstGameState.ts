import { applySequenceEvents } from './applySequenceEvent';

export type SequenceFirstState = Record<string, unknown> & { lastSequence?: number };
export type SequenceFirstEvent = { id?: string; sequence?: number; patch?: Record<string, unknown> | null; stateAfter?: Record<string, unknown> | null; logEntries?: unknown[]; clientMutationId?: string };

export type AdvanceSequenceFirstStateResult<TState extends SequenceFirstState> =
  | { status: 'unchanged'; state: TState }
  | { status: 'applied'; state: TState }
  | { status: 'recovery-required'; state: TState | null };

export function advanceSequenceFirstState<TState extends SequenceFirstState>(
  currentState: TState | null,
  sequences: SequenceFirstEvent[],
): AdvanceSequenceFirstStateResult<TState> {
  const currentSequence = Number(currentState?.lastSequence ?? 0);
  const ordered = [...sequences]
    .filter((sequence) => Number(sequence.sequence ?? 0) > currentSequence)
    .sort((left, right) => Number(left.sequence ?? 0) - Number(right.sequence ?? 0));
  if (!ordered.length && currentState) return { status: 'unchanged', state: currentState };
  if (!currentState || Number(ordered[0]?.sequence ?? 0) !== currentSequence + 1) {
    return { status: 'recovery-required', state: currentState };
  }
  const nextState = applySequenceEvents(currentState, ordered) as TState | null;
  return nextState
    ? { status: 'applied', state: nextState }
    : { status: 'recovery-required', state: currentState };
}
