export const ROLL_TO_FALL_SOUND_DELAY_MS = 500;

export const getChainedSoundDelayMs = (effect: string, hasFollowUp: boolean) => (
  effect === 'roll' && hasFollowUp ? ROLL_TO_FALL_SOUND_DELAY_MS : null
);
