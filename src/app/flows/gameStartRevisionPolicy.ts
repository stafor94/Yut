export type GameStartRevisionLike = {
  startRequestVersion?: unknown;
  startRequestId?: unknown;
};

const getStartRevisionKey = (value: GameStartRevisionLike | null | undefined) => {
  const version = Number(value?.startRequestVersion ?? 0);
  const requestId = String(value?.startRequestId ?? '');
  return Number.isFinite(version) && version > 0 && requestId ? `${Math.trunc(version)}:${requestId}` : '';
};

export const matchesCurrentRoomStartRevision = (
  roomStart: GameStartRevisionLike | null,
  state: GameStartRevisionLike | null,
) => {
  if (!state) return false;
  const roomStartKey = getStartRevisionKey(roomStart);
  if (!roomStartKey) return true;
  return getStartRevisionKey(state) === roomStartKey;
};
