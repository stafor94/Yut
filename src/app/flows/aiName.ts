import type { Seat } from '../appTypes';
import { DEFAULT_AI_DIFFICULTY, getEffectiveAiDifficulty, type AiDifficulty, type AiDifficultySource } from '../../game-core/aiDifficulty';

export const AI_NICKNAME_CANDIDATES: Record<AiDifficulty, readonly string[]> = {
  easy: ['윷린이', '새싹윷꾼', '말판연습생', '느긋한돌쇠', '동네윷꾼'],
  hard: ['윷도사', '말판장인', '전략대감', '천하윷꾼', '전설의윷꾼'],
};

const clampRandomIndex = (randomValue: number, candidateCount: number) => (
  Math.min(candidateCount - 1, Math.max(0, Math.floor(randomValue * candidateCount)))
);

export function getRandomAiNickname(
  difficultySource: AiDifficultySource | AiDifficulty = DEFAULT_AI_DIFFICULTY,
  usedNicknames: Iterable<string> = [],
  random: () => number = Math.random,
) {
  const difficulty = typeof difficultySource === 'string'
    ? getEffectiveAiDifficulty({ aiDifficulty: difficultySource })
    : getEffectiveAiDifficulty(difficultySource);
  const usedNicknameSet = new Set(usedNicknames);
  const candidates = AI_NICKNAME_CANDIDATES[difficulty] ?? AI_NICKNAME_CANDIDATES[DEFAULT_AI_DIFFICULTY];
  const unusedCandidates = candidates.filter((candidate) => !usedNicknameSet.has(candidate));
  const selectableCandidates = unusedCandidates.length ? unusedCandidates : candidates;
  const randomIndex = clampRandomIndex(random(), selectableCandidates.length);
  return selectableCandidates[randomIndex] ?? AI_NICKNAME_CANDIDATES[DEFAULT_AI_DIFFICULTY][0];
}

export function makeUniqueAIName(
  currentSeats: Pick<Seat, 'name' | 'isEmpty'>[],
  difficultySource: AiDifficultySource | AiDifficulty = DEFAULT_AI_DIFFICULTY,
  random: () => number = Math.random,
) {
  const usedNames = currentSeats.filter((seat) => !seat.isEmpty).map((seat) => seat.name);
  return getRandomAiNickname(difficultySource, usedNames, random);
}
