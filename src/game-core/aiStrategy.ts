import type { AiDifficulty } from './aiDifficulty';

export type AiScoreProfile = {
  finish: number;
  capture: number;
  shortcut: number;
  start: number;
  stack: number;
  candidateRange: number;
  rerollThreshold: number;
};

export type ScoredAiCandidate = {
  score: number;
};

export const AI_SCORE_PROFILES: Record<AiDifficulty, AiScoreProfile> = {
  hard: {
    finish: 80,
    capture: 90,
    shortcut: 55,
    start: 35,
    stack: 20,
    candidateRange: 20,
    rerollThreshold: 55,
  },
  easy: {
    finish: 70,
    capture: 55,
    shortcut: 35,
    start: 25,
    stack: 15,
    candidateRange: 45,
    rerollThreshold: 35,
  },
};

function getCandidateWeight(difficulty: AiDifficulty, scoreGap: number) {
  if (difficulty === 'hard') {
    if (scoreGap <= 0) return 70;
    if (scoreGap <= 10) return 22;
    return 8;
  }
  if (scoreGap <= 0) return 45;
  if (scoreGap <= 15) return 30;
  if (scoreGap <= 30) return 15;
  return 10;
}

export function chooseScoredAiCandidate<T extends ScoredAiCandidate>(candidates: T[], difficulty: AiDifficulty, random = Math.random) {
  if (!candidates.length) return undefined;
  if (candidates.length === 1) return candidates[0];

  if (difficulty === 'easy' && random() < 0.1) {
    return candidates[Math.min(candidates.length - 1, Math.floor(random() * candidates.length))];
  }

  const bestScore = candidates[0].score;
  const eligible = candidates.filter((candidate) => bestScore - candidate.score <= AI_SCORE_PROFILES[difficulty].candidateRange);
  const weighted = eligible.map((candidate) => ({ candidate, weight: getCandidateWeight(difficulty, bestScore - candidate.score) }));
  const totalWeight = weighted.reduce((sum, entry) => sum + entry.weight, 0);
  let cursor = random() * totalWeight;
  for (const entry of weighted) {
    cursor -= entry.weight;
    if (cursor < 0) return entry.candidate;
  }
  return weighted[weighted.length - 1]?.candidate ?? candidates[0];
}
