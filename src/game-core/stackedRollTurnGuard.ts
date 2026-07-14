let pendingStackedBonusRoll = false;

export function syncPendingStackedBonusRoll(params: {
  screen: string;
  rollStackLength: number;
  rollStackClosed: boolean;
}) {
  pendingStackedBonusRoll = params.screen === 'game'
    && params.rollStackLength > 0
    && params.rollStackClosed === false;
  return pendingStackedBonusRoll;
}

export function isPendingStackedBonusRoll() {
  return pendingStackedBonusRoll;
}

export function clearPendingStackedBonusRoll() {
  pendingStackedBonusRoll = false;
}
