export const TURN_ACTION_TIMEOUT_MS = 15000;
export const TURN_NETWORK_GRACE_MS = 2500;

export const getTurnRecoveryDeadlineAt = (turnDeadlineAt: number) => turnDeadlineAt + TURN_NETWORK_GRACE_MS;
