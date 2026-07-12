import type { RollTimingZone, YutResultName } from '../../game-core/roll';

export type RollSoundState = {
  phase?: 'primary' | 'extra-spin' | 'landing' | 'result-hold' | 'resolved';
  resultName?: YutResultName;
  fallCount?: number;
  timingZone?: RollTimingZone;
  turnOrder?: boolean;
};

export const isRollResultVisibleForSound = (state: RollSoundState) => {
  if (!state.resultName) return false;
  return state.phase !== 'primary' && state.phase !== 'extra-spin' && state.phase !== 'landing';
};

export const getRollOutcomeSoundEffect = (state: RollSoundState): 'bonus' | 'fall' | null => {
  if (state.turnOrder || !isRollResultVisibleForSound(state)) return null;
  if ((state.fallCount ?? 0) > 0) return 'fall';
  return state.resultName === '윷' || state.resultName === '모' ? 'bonus' : null;
};

export const shouldPlayPerfectRollSound = (state: RollSoundState) => state.timingZone === 'perfect' && !state.turnOrder;
