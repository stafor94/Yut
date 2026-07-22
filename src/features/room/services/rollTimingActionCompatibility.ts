import type { GameAction } from './roomServiceCore';

type CommittableGameAction = Omit<GameAction, 'id' | 'createdAt' | 'processed'>;

/** Older clients may still submit the removed Normal grade. Treat it as Bad at the online commit boundary. */
export const normalizeLegacyRollTimingAction = (action: CommittableGameAction): CommittableGameAction => (
  action.type === 'roll_yut' && action.payload?.rollTimingZone === 'normal'
    ? { ...action, payload: { ...action.payload, rollTimingZone: 'bad' } }
    : action
);
