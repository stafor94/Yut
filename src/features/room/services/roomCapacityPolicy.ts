import roomCapacityConfig from './roomCapacityConfig.json';

export type RoomKind = 'user' | 'qa';

export type QaRoomContext = {
  runId: string;
  role: string;
};

export type RoomKindSource = {
  title?: unknown;
  roomKind?: unknown;
  isQaRoom?: unknown;
  qaRunId?: unknown;
};

export const USER_ROOM_LIMIT = roomCapacityConfig.userRoomLimit;
export const QA_ROOM_LIMIT = roomCapacityConfig.qaRoomLimit;
export const LEGACY_ROOM_SCAN_LIMIT = roomCapacityConfig.legacyScanLimit;
export const TOTAL_ROOM_LIMIT = USER_ROOM_LIMIT + QA_ROOM_LIMIT;
export const QA_ROOM_TITLE_PREFIX = 'QA-';

const QA_RUN_ID_PATTERN = /^gh-\d+-\d+(?:-[a-z0-9-]+)*$/u;
const QA_ROLE_PATTERN = /^[a-z0-9-]+$/u;

const normalizeString = (value: unknown) => String(value ?? '').trim();

export const normalizeRoomTitleKey = (title: string) => title.trim().toLocaleLowerCase();

export const isValidQaRunId = (value: unknown) => QA_RUN_ID_PATTERN.test(normalizeString(value));

export const resolveQaRoomContext = ({
  title,
  runId,
  role,
}: {
  title: unknown;
  runId: unknown;
  role: unknown;
}): QaRoomContext | null => {
  const normalizedTitle = normalizeString(title);
  const normalizedRunId = normalizeString(runId).toLowerCase();
  const normalizedRole = normalizeString(role).toLowerCase();
  if (!normalizedTitle.startsWith(QA_ROOM_TITLE_PREFIX) || !isValidQaRunId(normalizedRunId)) return null;
  return {
    runId: normalizedRunId,
    role: QA_ROLE_PATTERN.test(normalizedRole) ? normalizedRole : 'qa',
  };
};

export const classifyRoomKind = (room: RoomKindSource): RoomKind => {
  if (room.roomKind === 'qa' || room.roomKind === 'user') return room.roomKind;
  if (room.isQaRoom === true || isValidQaRunId(room.qaRunId)) return 'qa';
  if (normalizeString(room.title).startsWith(QA_ROOM_TITLE_PREFIX)) return 'qa';
  return 'user';
};

export const getRoomLimit = (roomKind: RoomKind) => (
  roomKind === 'qa' ? QA_ROOM_LIMIT : USER_ROOM_LIMIT
);

export const isRoomLimitReached = (roomKind: RoomKind, roomCount: number) => (
  roomCount >= getRoomLimit(roomKind)
);
