type SnapshotRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is SnapshotRecord => Boolean(value && typeof value === 'object' && !Array.isArray(value));

const cloneObjectValue = (value: unknown) => isRecord(value) ? { ...value } : value;

const cloneArrayValue = (value: unknown) => Array.isArray(value)
  ? value.map((entry) => cloneObjectValue(entry))
  : value;

export function buildAuthoritativeApplyWakeSnapshot<TSnapshot extends object>(
  appliedValue: unknown,
  latestSnapshot: TSnapshot | null,
): TSnapshot | null {
  if (!isRecord(appliedValue)) return null;

  const appliedSnapshot = appliedValue;
  const latestRecord = (latestSnapshot ?? {}) as SnapshotRecord;
  const mergedSnapshot = { ...latestRecord, ...appliedSnapshot };
  const startRequestVersion = Number(appliedSnapshot.startRequestVersion ?? 0) || Number(latestRecord.startRequestVersion ?? 0);
  const startRequestId = String(appliedSnapshot.startRequestId ?? '') || String(latestRecord.startRequestId ?? '');
  const pieces = cloneArrayValue(appliedSnapshot.pieces ?? latestRecord.pieces);
  const gameSeats = cloneArrayValue(appliedSnapshot.gameSeats ?? latestRecord.gameSeats);
  const roll = cloneObjectValue(appliedSnapshot.roll ?? latestRecord.roll);
  const rollStack = cloneArrayValue(appliedSnapshot.rollStack ?? latestRecord.rollStack);

  return {
    ...mergedSnapshot,
    ...(startRequestVersion ? { startRequestVersion } : {}),
    ...(startRequestId ? { startRequestId } : {}),
    pieces,
    gameSeats,
    roll,
    rollStack,
  } as TSnapshot;
}
