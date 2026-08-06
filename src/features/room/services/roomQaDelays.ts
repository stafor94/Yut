type RoomQaDelayGlobals = typeof globalThis & {
  __YUT_QA_DELAY_MOVE_PIECE_COMMIT_AFTER_RESERVATION_MS__?: unknown;
};

export const getQaMoveCommitDelayAfterReservationMs = () => {
  const value = Number((globalThis as RoomQaDelayGlobals).__YUT_QA_DELAY_MOVE_PIECE_COMMIT_AFTER_RESERVATION_MS__ ?? 0);
  return Number.isFinite(value) ? Math.max(0, value) : 0;
};

export const waitForQaMoveCommitDelayAfterReservation = async (enabled: boolean) => {
  if (!enabled) return;
  const delayMs = getQaMoveCommitDelayAfterReservationMs();
  if (delayMs <= 0) return;
  await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
};
