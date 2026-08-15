type SequencedAuthoritativeState = {
  lastSequence?: number;
  turnVersion?: number;
};

const toVersion = (value: unknown) => {
  const numericValue = Number(value ?? 0);
  return Number.isFinite(numericValue) ? Math.max(0, Math.trunc(numericValue)) : 0;
};

export function selectNewerAuthoritativeState<
  TCurrent extends SequencedAuthoritativeState,
  TCandidate extends SequencedAuthoritativeState,
>(
  currentState: TCurrent | null | undefined,
  candidateState: TCandidate | null | undefined,
): TCurrent | TCandidate | null {
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
