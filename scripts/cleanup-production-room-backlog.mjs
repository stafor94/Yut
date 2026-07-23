import fs from 'node:fs';

const roomCapacityConfig = JSON.parse(fs.readFileSync(new URL('../src/features/room/services/roomCapacityConfig.json', import.meta.url), 'utf8'));
const firebaseConfig = JSON.parse(fs.readFileSync(new URL('../firebase.production.json', import.meta.url), 'utf8'));

const USER_ROOM_LIMIT = Number(roomCapacityConfig.userRoomLimit ?? 3);
const QA_ROOM_LIMIT = Number(roomCapacityConfig.qaRoomLimit ?? 8);
const PROJECT_ID = String(firebaseConfig.projectId ?? '').trim();
const DATABASE_ID = String(process.env.FIRESTORE_DATABASE_ID ?? '(default)').trim();
const ACCESS_TOKEN = String(process.env.GOOGLE_OAUTH_ACCESS_TOKEN ?? '').trim();
const APPLY = process.argv.includes('--apply');
const CONFIRMED = process.env.ALLOW_PRODUCTION_ROOM_CLEANUP === '1';
const MIN_INACTIVE_AGE_MS = Number(process.env.ROOM_CLEANUP_MIN_AGE_MS ?? 2 * 60 * 60 * 1000);
const ROOM_SUBCOLLECTIONS = ['actions', 'boardItems', 'players', 'rooms', 'seats', 'state', 'sequences', 'processedActions'];

if (PROJECT_ID !== 'yut-online') throw new Error(`예상하지 못한 production projectId: ${PROJECT_ID || '없음'}`);
if (!ACCESS_TOKEN) throw new Error('GOOGLE_OAUTH_ACCESS_TOKEN이 필요합니다. gcloud auth application-default print-access-token 등의 제한된 관리자 토큰을 사용하세요.');
if (!Number.isFinite(MIN_INACTIVE_AGE_MS) || MIN_INACTIVE_AGE_MS < 60_000) throw new Error(`잘못된 ROOM_CLEANUP_MIN_AGE_MS: ${MIN_INACTIVE_AGE_MS}`);
if (APPLY && !CONFIRMED) throw new Error('--apply 실행에는 ALLOW_PRODUCTION_ROOM_CLEANUP=1이 필요합니다.');

const databaseRoot = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(PROJECT_ID)}/databases/${encodeURIComponent(DATABASE_ID)}/documents`;

function decodeValue(value) {
  if (!value || typeof value !== 'object') return null;
  if ('nullValue' in value) return null;
  if ('booleanValue' in value) return value.booleanValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return Number(value.doubleValue);
  if ('stringValue' in value) return value.stringValue;
  if ('timestampValue' in value) return value.timestampValue;
  if ('arrayValue' in value) return (value.arrayValue?.values ?? []).map(decodeValue);
  if ('mapValue' in value) return decodeFields(value.mapValue?.fields ?? {});
  return null;
}

function decodeFields(fields = {}) {
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, decodeValue(value)]));
}

function timestampMillis(value) {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function roomTimestamp(room) {
  return timestampMillis(room.qaCreatedAt)
    || timestampMillis(room.createdAt)
    || timestampMillis(room.lastActivityAt)
    || timestampMillis(room.lastHumanSeenAt);
}

function isQaRoom(room) {
  return room.roomKind === 'qa'
    || room.isQaRoom === true
    || Boolean(String(room.qaRunId ?? '').trim())
    || String(room.title ?? '').startsWith('QA-');
}

function isSystemRoom(room) {
  return Boolean(String(room.systemRoomType ?? '').trim());
}

function isInactiveRoom(room, now = Date.now()) {
  const timestamp = roomTimestamp(room);
  const oldEnough = timestamp > 0 && now - timestamp >= MIN_INACTIVE_AGE_MS;
  return room.status === 'finished'
    || Number(room.currentPlayers ?? 0) <= 0
    || Boolean(room.deletingAt)
    || oldEnough;
}

async function firestoreRequest(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${ACCESS_TOKEN}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers ?? {}),
    },
  });
  if (response.status === 404 && options.allowNotFound) return null;
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Firestore REST ${options.method ?? 'GET'} ${response.status}: ${body}`);
  }
  if (response.status === 204) return null;
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function listCollection(parentPath, collectionName) {
  const documents = [];
  let pageToken = '';
  do {
    const parent = parentPath ? `${databaseRoot}/${parentPath}` : databaseRoot;
    const url = new URL(`${parent}/${encodeURIComponent(collectionName)}`);
    url.searchParams.set('pageSize', '100');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const payload = await firestoreRequest(url.toString(), { allowNotFound: true }) ?? {};
    for (const document of payload.documents ?? []) {
      const id = String(document.name ?? '').split('/').at(-1) ?? '';
      documents.push({
        id,
        path: String(document.name ?? '').split('/documents/').at(-1) ?? '',
        ...decodeFields(document.fields ?? {}),
      });
    }
    pageToken = String(payload.nextPageToken ?? '');
  } while (pageToken);
  return documents;
}

async function deleteDocument(documentPath) {
  await firestoreRequest(`${databaseRoot}/${documentPath.split('/').map(encodeURIComponent).join('/')}`, {
    method: 'DELETE',
    allowNotFound: true,
  });
}

async function deleteRoomRecursively(room) {
  const deletedCounts = {};
  for (const subcollectionName of ROOM_SUBCOLLECTIONS) {
    const documents = await listCollection(`rooms/${room.id}`, subcollectionName);
    for (const document of documents) await deleteDocument(document.path);
    if (documents.length) deletedCounts[subcollectionName] = documents.length;
  }
  await deleteDocument(`rooms/${room.id}`);
  return deletedCounts;
}

function buildCleanupPlan(rooms, now = Date.now()) {
  const ordinaryRooms = rooms.filter((room) => !isSystemRoom(room) && !isQaRoom(room));
  const qaRooms = rooms.filter((room) => !isSystemRoom(room) && isQaRoom(room));
  const newestQaRooms = [...qaRooms].sort((left, right) => roomTimestamp(right) - roomTimestamp(left));
  const qaOverflowIds = new Set(newestQaRooms.slice(QA_ROOM_LIMIT).map((room) => room.id));
  const qaTargets = newestQaRooms.filter((room) => isInactiveRoom(room, now) || qaOverflowIds.has(room.id));
  const userTargets = ordinaryRooms.filter((room) => isInactiveRoom(room, now));
  return {
    qaRooms,
    ordinaryRooms,
    qaTargets,
    userTargets,
    targets: [...qaTargets, ...userTargets],
  };
}

const rooms = await listCollection('', 'rooms');
const plan = buildCleanupPlan(rooms);
const activeQaRooms = plan.qaRooms.filter((room) => !plan.qaTargets.some((target) => target.id === room.id));
const activeUserRooms = plan.ordinaryRooms.filter((room) => !plan.userTargets.some((target) => target.id === room.id));

console.log(`Production room backlog ${APPLY ? 'apply' : 'dry-run'}: total=${rooms.length}, user=${plan.ordinaryRooms.length}, qa=${plan.qaRooms.length}, delete=${plan.targets.length}`);
console.log(`삭제 후 예상: user=${activeUserRooms.length}/${USER_ROOM_LIMIT}, qa=${activeQaRooms.length}/${QA_ROOM_LIMIT}`);
plan.targets.forEach((room) => {
  console.log(`[TARGET] ${room.id} kind=${isQaRoom(room) ? 'qa' : 'user'} status=${String(room.status ?? '없음')} currentPlayers=${String(room.currentPlayers ?? '없음')} title=${String(room.title ?? '제목 없음')}`);
});

if (!APPLY) {
  console.log('Dry-run only. 검토 후 ALLOW_PRODUCTION_ROOM_CLEANUP=1과 --apply를 함께 사용하세요.');
  process.exit(0);
}

for (const room of plan.targets) {
  const deletedCounts = await deleteRoomRecursively(room);
  console.log(`[DELETED] ${room.id} ${JSON.stringify(deletedCounts)}`);
}

const remainingRooms = await listCollection('', 'rooms');
const remainingPlan = buildCleanupPlan(remainingRooms);
const remainingActiveQa = remainingPlan.qaRooms.filter((room) => !remainingPlan.qaTargets.some((target) => target.id === room.id));
const remainingActiveUsers = remainingPlan.ordinaryRooms.filter((room) => !remainingPlan.userTargets.some((target) => target.id === room.id));
if (remainingPlan.targets.length > 0) throw new Error(`삭제 후에도 정리 대상이 남았습니다: ${remainingPlan.targets.length}`);
if (remainingActiveQa.length > QA_ROOM_LIMIT) throw new Error(`QA 방 상한 초과: ${remainingActiveQa.length}/${QA_ROOM_LIMIT}`);
if (remainingActiveUsers.length > USER_ROOM_LIMIT) {
  throw new Error(`활성 사용자 방이 상한을 초과하지만 안전을 위해 자동 삭제하지 않았습니다: ${remainingActiveUsers.length}/${USER_ROOM_LIMIT}`);
}
console.log(`Production room cleanup complete: total=${remainingRooms.length}, user=${remainingActiveUsers.length}, qa=${remainingActiveQa.length}`);
