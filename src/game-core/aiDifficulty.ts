export type AiDifficulty = 'easy' | 'hard';

export const DEFAULT_AI_DIFFICULTY: AiDifficulty = 'hard';

export type AiDifficultySource = {
  aiDifficulty?: unknown;
  isSubstitutedByAI?: boolean;
} | null | undefined;

export type AiDifficultySeatSource = NonNullable<AiDifficultySource> & { id: string };

export function getEffectiveAiDifficulty(source: AiDifficultySource): AiDifficulty {
  if (source?.isSubstitutedByAI) return 'hard';
  return source?.aiDifficulty === 'easy' ? 'easy' : DEFAULT_AI_DIFFICULTY;
}

let currentAiRollDifficulty: AiDifficulty = DEFAULT_AI_DIFFICULTY;
const runtimeAiDifficultyBySeatId = new Map<string, AiDifficulty>();

export function setCurrentAiRollDifficulty(source: AiDifficultySource | AiDifficulty) {
  currentAiRollDifficulty = typeof source === 'string' ? source : getEffectiveAiDifficulty(source);
}

export function getCurrentAiRollDifficulty() {
  return currentAiRollDifficulty;
}

export function replaceRuntimeAiDifficulties(sources: AiDifficultySeatSource[]) {
  runtimeAiDifficultyBySeatId.clear();
  sources.forEach((source) => runtimeAiDifficultyBySeatId.set(source.id, getEffectiveAiDifficulty(source)));
}

export function getRuntimeAiDifficultyForSeat(seatId: string, fallback?: AiDifficultySource) {
  return runtimeAiDifficultyBySeatId.get(seatId) ?? getEffectiveAiDifficulty(fallback);
}

export function clearRuntimeAiDifficulties() {
  runtimeAiDifficultyBySeatId.clear();
  currentAiRollDifficulty = DEFAULT_AI_DIFFICULTY;
}
