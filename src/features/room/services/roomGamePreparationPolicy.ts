export const ROOM_START_CANCEL_LOCK_MS = 2_000;
export const ROOM_START_ACTIVATION_GRACE_MS = 5_000;

export const isRoomGamePreparationWindowOpen = (countdownEndsAt: number, now = Date.now()) => (
  countdownEndsAt > 0
  && now >= countdownEndsAt - ROOM_START_CANCEL_LOCK_MS
  && now < countdownEndsAt
);

export const isRoomGameActivationWindowOpen = (countdownEndsAt: number, now = Date.now()) => (
  countdownEndsAt > 0
  && now >= countdownEndsAt
  && now <= countdownEndsAt + ROOM_START_ACTIVATION_GRACE_MS
);
