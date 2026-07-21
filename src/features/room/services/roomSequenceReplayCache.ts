export type CachedGameSequence = { sequence?: unknown };

type ReplayTarget = {
  token: symbol;
  localSequence: number;
  remoteSequence: number;
};

const DEFAULT_SEQUENCE_CACHE_LIMIT = 8;
const sequencesByRoom = new Map<string, CachedGameSequence[]>();
const replayTargetsByRoom = new Map<string, ReplayTarget[]>();

const normalizeSequence = (value: unknown) => {
  const sequence = Number(value ?? 0);
  return Number.isInteger(sequence) && sequence > 0 ? sequence : 0;
};

export function replaceCachedGameSequences<TSequence extends CachedGameSequence>(
  roomId: string,
  sequences: TSequence[],
  limit = DEFAULT_SEQUENCE_CACHE_LIMIT,
) {
  if (!roomId) return;
  const deduplicated = new Map<number, CachedGameSequence>();
  sequences.forEach((sequence) => {
    const sequenceNumber = normalizeSequence(sequence.sequence);
    if (sequenceNumber > 0) deduplicated.set(sequenceNumber, sequence);
  });
  const normalizedLimit = Math.max(1, Math.floor(limit));
  sequencesByRoom.set(
    roomId,
    [...deduplicated.entries()]
      .sort(([left], [right]) => left - right)
      .slice(-normalizedLimit)
      .map(([, sequence]) => sequence),
  );
}

export function clearCachedGameSequences(roomId: string) {
  if (!roomId) return;
  sequencesByRoom.delete(roomId);
  replayTargetsByRoom.delete(roomId);
}

export function hasCachedGameSequence(roomId: string, sequence: number) {
  const targetSequence = normalizeSequence(sequence);
  if (!roomId || targetSequence <= 0) return false;
  return (sequencesByRoom.get(roomId) ?? [])
    .some((entry) => normalizeSequence(entry.sequence) === targetSequence);
}

export function getCachedGameSequencesForReplay<TSequence extends CachedGameSequence>(
  roomId: string,
  afterSequence: number,
): TSequence[] | null {
  const replayTargets = replayTargetsByRoom.get(roomId);
  const replayTarget = replayTargets?.[replayTargets.length - 1];
  if (!replayTarget) return null;

  const normalizedAfterSequence = Math.max(0, Math.floor(Number(afterSequence) || 0));
  if (normalizedAfterSequence > replayTarget.localSequence || replayTarget.remoteSequence <= replayTarget.localSequence) return null;

  const cachedBySequence = new Map<number, CachedGameSequence>();
  (sequencesByRoom.get(roomId) ?? []).forEach((sequence) => {
    const sequenceNumber = normalizeSequence(sequence.sequence);
    if (sequenceNumber > 0) cachedBySequence.set(sequenceNumber, sequence);
  });

  const replaySequences: CachedGameSequence[] = [];
  for (let sequence = replayTarget.localSequence + 1; sequence <= replayTarget.remoteSequence; sequence += 1) {
    const cached = cachedBySequence.get(sequence);
    if (!cached) return null;
    replaySequences.push(cached);
  }
  return replaySequences as TSequence[];
}

export async function withGameSequenceReplayCache<TResult>(
  roomId: string,
  localSequence: number,
  remoteSequence: number,
  operation: () => Promise<TResult> | TResult,
): Promise<TResult> {
  const normalizedLocalSequence = Math.max(0, Math.floor(Number(localSequence) || 0));
  const normalizedRemoteSequence = Math.max(0, Math.floor(Number(remoteSequence) || 0));
  if (!roomId || normalizedRemoteSequence <= normalizedLocalSequence) return await operation();

  const target: ReplayTarget = {
    token: Symbol(roomId),
    localSequence: normalizedLocalSequence,
    remoteSequence: normalizedRemoteSequence,
  };
  const targets = replayTargetsByRoom.get(roomId) ?? [];
  targets.push(target);
  replayTargetsByRoom.set(roomId, targets);

  try {
    return await operation();
  } finally {
    const currentTargets = replayTargetsByRoom.get(roomId) ?? [];
    const targetIndex = currentTargets.findIndex((entry) => entry.token === target.token);
    if (targetIndex >= 0) currentTargets.splice(targetIndex, 1);
    if (currentTargets.length) replayTargetsByRoom.set(roomId, currentTargets);
    else replayTargetsByRoom.delete(roomId);
  }
}
