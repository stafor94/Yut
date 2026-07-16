export type AiDifficulty = 'easy' | 'hard';

export const DEFAULT_AI_DIFFICULTY: AiDifficulty = 'hard';

export type AiDifficultySource = {
  aiDifficulty?: unknown;
  isSubstitutedByAI?: boolean;
} | null | undefined;

export type AiDifficultySeatSource = NonNullable<AiDifficultySource> & { id: string };

export type AiDifficultyManageSource = {
  isAI?: boolean;
  isSubstitutedByAI?: boolean;
} | null | undefined;

export function getEffectiveAiDifficulty(source: AiDifficultySource): AiDifficulty {
  if (source?.isSubstitutedByAI) return 'hard';
  return source?.aiDifficulty === 'easy' ? 'easy' : DEFAULT_AI_DIFFICULTY;
}

export function getAiDifficultyBadgeLabel(source: AiDifficultySource | AiDifficulty) {
  const difficulty = typeof source === 'string' ? source : getEffectiveAiDifficulty(source);
  return difficulty === 'easy' ? '쉬움 AI' : '어려움 AI';
}

export function canManageAiDifficulty(canManageRoom: boolean, source: AiDifficultyManageSource) {
  return canManageRoom && Boolean(source?.isAI) && !source?.isSubstitutedByAI;
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
