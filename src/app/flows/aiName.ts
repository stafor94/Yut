import type { Seat } from '../appTypes';
import { AI_NAME_BASES, AI_NAME_PREFIXES } from '../constants/playerPresentation';

export function makeUniqueAIName(
  currentSeats: Pick<Seat, 'name' | 'isEmpty'>[],
  random: () => number = Math.random,
) {
  const usedNames = new Set(currentSeats.filter((seat) => !seat.isEmpty).map((seat) => seat.name));
  const candidates = AI_NAME_BASES
    .flatMap((baseName) => AI_NAME_PREFIXES.map((prefix) => `${prefix} ${baseName}`))
    .filter((name) => !usedNames.has(name));

  if (candidates.length) {
    const randomIndex = Math.min(candidates.length - 1, Math.max(0, Math.floor(random() * candidates.length)));
    return candidates[randomIndex];
  }

  let suffix = 1;
  while (usedNames.has(`AI 친구 ${suffix}`)) suffix += 1;
  return `AI 친구 ${suffix}`;
}
