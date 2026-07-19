type TurnOrderSeedSeat = {
  id: string;
  label: string;
};

export const getStableTurnOrderScore = (seed: string, seatId: string) => {
  const value = `${seed}:${seatId}`;
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

export const getSeededTurnOrderSeats = <TSeat extends TurnOrderSeedSeat>(targetSeats: TSeat[], seed: string) => [...targetSeats].sort((left, right) => {
  const scoreDiff = getStableTurnOrderScore(seed, left.id) - getStableTurnOrderScore(seed, right.id);
  return scoreDiff || left.label.localeCompare(right.label, undefined, { numeric: true });
});
