type SequencedAuthoritativeState = {
  lastSequence?: number;
  turnVersion?: number;
};

const toVersion = (value: unknown) => {
  const numericValue = Number(value ?? 0);
  return Number.isFinite(numericValue) ? Math.max(0, Math.trunc(numericValue)) : 0;
};

export function selectNewerAuthoritativeState<T extends SequencedAuthoritativeState>(
  currentState: T | null | undefined,
  candidateState: T | null | undefined,
): T | null {
  if (!currentState) return candidateState ?? null;
  if (!candidateState) return currentState;

  const currentSequence = toVersion(currentState.lastSequence);
  const candidateSequence = toVersion(candidateState.lastSequence);
  if (candidateSequence !== currentSequence) {
    return candidateSequence > currentSequence ? candidateState : currentState;
  }

  const currentTurnVersion = toVersion(currentState.turnVersion);
  const candidateTurnVersion = toVersion(candidateState.turnVersion);
  return candidateTurnVersion > currentTurnVersion ? candidateState : currentState;
}
