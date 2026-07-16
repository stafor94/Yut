export type AiDifficulty = 'easy' | 'hard';

export const DEFAULT_AI_DIFFICULTY: AiDifficulty = 'hard';

export type AiDifficultySource = {
  aiDifficulty?: unknown;
  isSubstitutedByAI?: boolean;
} | null | undefined;

export function getEffectiveAiDifficulty(source: AiDifficultySource): AiDifficulty {
  if (source?.isSubstitutedByAI) return 'hard';
  return source?.aiDifficulty === 'easy' ? 'easy' : DEFAULT_AI_DIFFICULTY;
}

let currentAiRollDifficulty: AiDifficulty = DEFAULT_AI_DIFFICULTY;

export function setCurrentAiRollDifficulty(source: AiDifficultySource | AiDifficulty) {
  currentAiRollDifficulty = typeof source === 'string' ? source : getEffectiveAiDifficulty(source);
}

export function getCurrentAiRollDifficulty() {
  return currentAiRollDifficulty;
}
