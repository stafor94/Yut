export const ONLINE_ROLL_PRIMARY_MS = 1200;
export const ONLINE_ROLL_EXTRA_SPIN_MS = 1000;
export const ONLINE_ROLL_LANDING_MS = 1000;
export const ONLINE_ROLL_RESULT_HOLD_MS = 2600;

export const ONLINE_ROLL_FAST_PRESENTATION_MS = ONLINE_ROLL_PRIMARY_MS
  + ONLINE_ROLL_LANDING_MS
  + ONLINE_ROLL_RESULT_HOLD_MS;

export const ONLINE_ROLL_LATE_RESOLUTION_PRESENTATION_MS = ONLINE_ROLL_EXTRA_SPIN_MS
  + ONLINE_ROLL_LANDING_MS
  + ONLINE_ROLL_RESULT_HOLD_MS;

const normalizeTimestamp = (value: unknown) => {
  const timestamp = Number(value ?? 0);
  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : 0;
};

/**
 * The pending online roll keeps its primary spin until 1.2s. Once that boundary
 * has passed, a result received during extra-spin lands on the next 1s boundary.
 * The authoritative action-ready timestamp therefore has to cover either the
 * fixed fast path or one full extra-spin interval after a late resolution.
 */
export const getAuthoritativeRollPresentationReadyAt = ({
  actionStartedAt,
  resolvedAt = Date.now(),
}: {
  actionStartedAt?: unknown;
  resolvedAt?: number;
}) => {
  const normalizedResolvedAt = normalizeTimestamp(resolvedAt) || Date.now();
  const normalizedStartedAt = normalizeTimestamp(actionStartedAt);
  if (!normalizedStartedAt) {
    return normalizedResolvedAt + ONLINE_ROLL_FAST_PRESENTATION_MS;
  }

  const primaryEndsAt = normalizedStartedAt + ONLINE_ROLL_PRIMARY_MS;
  if (normalizedResolvedAt <= primaryEndsAt) {
    return primaryEndsAt + ONLINE_ROLL_LANDING_MS + ONLINE_ROLL_RESULT_HOLD_MS;
  }

  return normalizedResolvedAt + ONLINE_ROLL_LATE_RESOLUTION_PRESENTATION_MS;
};
