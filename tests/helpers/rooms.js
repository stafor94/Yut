import { initializeApp, getApps } from 'firebase/app';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { Timestamp, collection, connectFirestoreEmulator, deleteDoc, doc, getDoc, getDocs, getFirestore, query, serverTimestamp, updateDoc, where, writeBatch } from 'firebase/firestore';
import { loadFirebaseConfig } from './env.js';

const roomSubcollections = ['actions', 'boardItems', 'players', 'rooms', 'seats', 'state', 'sequences', 'processedActions'];
const oldRoomMaxAgeMs = 2 * 60 * 60 * 1000;
const roomDeleteBatchSize = 25;
let dbPromise;
let testProjectId = '';
let testAuthUserId = '';
const roomAccessTokens = new Map();

function getTimestampMillis(value) {
  if (value && typeof value === 'object' && typeof value.toMillis === 'function') return value.toMillis();
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  return 0;
}

function getRoomAgeMs(room, now = Date.now()) {
  const createdAt = getTimestampMillis(room.createdAt);
  return createdAt ? now - createdAt : 0;
}

export function isOldRoom(room, now = Date.now()) {
  return getRoomAgeMs(room, now) >= oldRoomMaxAgeMs;
}

export function isMalformedUntitledRoom(room) {
  const title = typeof room.title === 'string' ? room.title.trim() : '';
  return !title && !getTimestampMillis(room.createdAt);
}

export function isInactiveRoom(room, now = Date.now()) {
  const emptyGhost = room.currentPlayers !== undefined && Number(room.currentPlayers) <= 0;
  return room.status === 'finished' || isOldRoom(room, now) || emptyGhost || isMalformedUntitledRoom(room);
}

export function summarizeRemainingRoomReason(room, now = Date.now()) {
  const reasons = [];
  const createdAt = getTimestampMillis(room.createdAt);
  const ageMs = getRoomAgeMs(room, now);
  const ageMinutes = createdAt ? Math.floor(ageMs / 60000) : null;

  if (isMalformedUntitledRoom(room)) reasons.push('createdAt과 title이 없어 삭제 대상이지만 남아 있음');
  else if (!createdAt) reasons.push('createdAt 없음: 2시간 초과 여부를 판단할 수 없음');
  else if (ageMs < oldRoomMaxAgeMs) reasons.push(`생성 후 ${ageMinutes}분 경과: 2시간 미만`);
  else reasons.push(`생성 후 ${ageMinutes}분 경과: 2시간 이상이라 삭제 대상이지만 남아 있음`);

  if (room.status === 'finished') reasons.push('status=finished라 삭제 대상이지만 남아 있음');
  else reasons.push(`status=${String(room.status ?? '없음')}`);

  if (room.currentPlayers !== undefined && Number(room.currentPlayers) <= 0) reasons.push(`currentPlayers=${String(room.currentPlayers)}라 삭제 대상이지만 남아 있음`);
  else reasons.push(`currentPlayers=${String(room.currentPlayers ?? '없음')}`);

  const title = String(room.title ?? '');
  if (title.startsWith('QA-')) reasons.push('title이 QA-로 시작해 QA 삭제 대상이지만 남아 있음');
  else reasons.push('title이 QA-로 시작하지 않아 QA 이름 기준 삭제 대상은 아님');

  return reasons.join('; ');
}

function getQaRunId() {
  return String(process.env.QA_RUN_ID ?? '').trim();
}

function getQaRole() {
  return String(process.env.QA_ROLE ?? '').trim();
}

function assertProductionQaAccess(config, qaRunId, emulatorEndpoint) {
  if (!qaRunId || emulatorEndpoint) return;
  if (process.env.QA_ALLOW_PRODUCTION_FIREBASE !== '1') {
    throw new Error('운영 Firebase QA는 QA_ALLOW_PRODUCTION_FIREBASE=1이 필요합니다.');
  }
  if (config.projectId !== 'yut-online') {
    throw new Error(`운영 QA helper의 projectId가 yut-online이 아닙니다: ${String(config.projectId ?? '')}`);
  }
  if (!/^gh-\d+-\d+-[a-z0-9-]+$/u.test(qaRunId)) {
    throw new Error(`운영 QA_RUN_ID 형식이 올바르지 않습니다: ${qaRunId}`);
  }
}

export async function getTestDb() {
  if (!dbPromise) {
    dbPromise = (async () => {
      const config = await loadFirebaseConfig();
      if (!config) return null;
      const qaRunId = getQaRunId();
      const emulatorEndpoint = String(process.env.FIRESTORE_EMULATOR_HOST ?? '').trim();
      assertProductionQaAccess(config, qaRunId, emulatorEndpoint);
      if (qaRunId && emulatorEndpoint && !String(config.projectId ?? '').startsWith('demo-')) {
        throw new Error(`Emulator QA helper가 demo projectId를 요구합니다: ${String(config.projectId ?? '')}`);
      }
      const appName = qaRunId ? `qa-${qaRunId}`.slice(0, 40) : 'qa-helper';
      const app = getApps().find((candidate) => candidate.name === appName) ?? initializeApp(config, appName);
      const auth = getAuth(app);
      if (!auth.currentUser) await signInAnonymously(auth);
      testAuthUserId = auth.currentUser?.uid ?? '';
      testProjectId = String(config.projectId ?? '');
      const firestore = getFirestore(app);
      if (emulatorEndpoint) {
        const [host, rawPort] = emulatorEndpoint.split(':');
        const port = Number(rawPort);
        if (!['127.0.0.1', 'localhost'].includes(host) || !Number.isInteger(port) || port <= 0) throw new Error(`잘못된 Firestore emulator endpoint: ${emulatorEndpoint}`);
        connectFirestoreEmulator(firestore, host, port);
      }
      return firestore;
    })();
  }
  return dbPromise;
}

function encodeFirestoreValue(value) {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'number') {
    return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  }
  if (value instanceof Date) return { timestampValue: value.toISOString() };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encodeFirestoreValue) } };
  if (typeof value === 'object') {
    return { mapValue: { fields: Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, encodeFirestoreValue(nested)])) } };
  }
  throw new Error(`지원하지 않는 Firestore 값입니다: ${typeof value}`);
}

function decodeFirestoreValue(value) {
  if (!value || typeof value !== 'object') return null;
  if ('nullValue' in value) return null;
  if ('booleanValue' in value) return value.booleanValue;
  if ('stringValue' in value) return value.stringValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return Number(value.doubleValue);
  if ('timestampValue' in value) return new Date(value.timestampValue);
  if ('arrayValue' in value) return (value.arrayValue?.values ?? []).map(decodeFirestoreValue);
  if ('mapValue' in value) return decodeFirestoreFields(value.mapValue?.fields ?? {});
  if ('referenceValue' in value) return value.referenceValue;
  if ('geoPointValue' in value) return value.geoPointValue;
  return null;
}

function decodeFirestoreFields(fields = {}) {
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, decodeFirestoreValue(value)]));
}

function getFirestoreDocumentUrl(pathSegments) {
  if (!testProjectId) throw new Error('Firebase projectId가 준비되지 않았습니다.');
  const encodedPath = pathSegments.map((segment) => encodeURIComponent(segment)).join('/');
  return `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(testProjectId)}/databases/(default)/documents/${encodedPath}`;
}

async function firestoreRest(url, accessToken, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
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

async function getRestDocument(pathSegments, accessToken) {
  const document = await firestoreRest(getFirestoreDocumentUrl(pathSegments), accessToken, { allowNotFound: true });
  if (!document) return null;
  return { id: pathSegments.at(-1), ...decodeFirestoreFields(document.fields ?? {}) };
}

async function listRestDocuments(parentSegments, collectionName, accessToken) {
  const documents = [];
  let pageToken = '';
  do {
    const baseUrl = `${getFirestoreDocumentUrl(parentSegments)}/${encodeURIComponent(collectionName)}`;
    const url = new URL(baseUrl);
    url.searchParams.set('pageSize', '100');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const payload = await firestoreRest(url.toString(), accessToken, { allowNotFound: true }) ?? {};
    for (const document of payload.documents ?? []) {
      const id = String(document.name ?? '').split('/').at(-1) ?? '';
      documents.push({ id, name: document.name, ...decodeFirestoreFields(document.fields ?? {}) });
    }
    pageToken = String(payload.nextPageToken ?? '');
  } while (pageToken);
  return documents;
}

async function patchRestDocument(pathSegments, patch, accessToken) {
  const url = new URL(getFirestoreDocumentUrl(pathSegments));
  Object.keys(patch).forEach((fieldPath) => url.searchParams.append('updateMask.fieldPaths', fieldPath));
  const fields = Object.fromEntries(Object.entries(patch).map(([key, value]) => [key, encodeFirestoreValue(value)]));
  const document = await firestoreRest(url.toString(), accessToken, { method: 'PATCH', body: JSON.stringify({ fields }) });
  return { id: pathSegments.at(-1), ...decodeFirestoreFields(document.fields ?? {}) };
}

async function deleteRestDocument(pathSegments, accessToken) {
  await firestoreRest(getFirestoreDocumentUrl(pathSegments), accessToken, { method: 'DELETE', allowNotFound: true });
}

async function readFirebaseAccessTokenFromPage(page) {
  return page.evaluate(async () => {
    const findToken = (value, depth = 0) => {
      if (!value || depth > 8) return '';
      if (typeof value === 'string') return value.startsWith('eyJ') && value.split('.').length === 3 ? value : '';
      if (Array.isArray(value)) {
        for (const nested of value) {
          const token = findToken(nested, depth + 1);
          if (token) return token;
        }
        return '';
      }
      if (typeof value === 'object') {
        if (typeof value.accessToken === 'string' && value.accessToken.startsWith('eyJ')) return value.accessToken;
        for (const nested of Object.values(value)) {
          const token = findToken(nested, depth + 1);
          if (token) return token;
        }
      }
      return '';
    };

    return new Promise((resolve) => {
      const request = indexedDB.open('firebaseLocalStorageDb');
      request.onerror = () => resolve('');
      request.onsuccess = () => {
        const database = request.result;
        const stores = Array.from(database.objectStoreNames);
        if (!stores.length) {
          database.close();
          resolve('');
          return;
        }
        let pending = stores.length;
        let resolved = false;
        for (const storeName of stores) {
          const transaction = database.transaction(storeName, 'readonly');
          const getAllRequest = transaction.objectStore(storeName).getAll();
          getAllRequest.onerror = () => {
            pending -= 1;
            if (!resolved && pending === 0) {
              database.close();
              resolve('');
            }
          };
          getAllRequest.onsuccess = () => {
            const token = findToken(getAllRequest.result);
            pending -= 1;
            if (token && !resolved) {
              resolved = true;
              database.close();
              resolve(token);
            } else if (!resolved && pending === 0) {
              database.close();
              resolve('');
            }
          };
        }
      };
    });
  });
}

async function rememberRoomAccessToken(roomId, page) {
  if (!roomId || !page) return '';
  const accessToken = await readFirebaseAccessTokenFromPage(page);
  if (accessToken) roomAccessTokens.set(roomId, accessToken);
  return accessToken;
}

export async function markRoomForQa(roomId, metadata = {}) {
  const db = await getTestDb();
  const qaRunId = String(metadata.qaRunId ?? getQaRunId()).trim();
  const qaRole = String(metadata.qaRole ?? getQaRole()).trim();
  if (!db || !roomId || !qaRunId) return false;
  const patch = {
    isQaRoom: true,
    qaRunId,
    qaRole,
    qaCreatedAt: new Date(),
  };
  const accessToken = roomAccessTokens.get(roomId);
  if (accessToken) await patchRestDocument(['rooms', roomId], patch, accessToken);
  else await updateDoc(doc(db, 'rooms', roomId), { ...patch, qaCreatedAt: serverTimestamp() });
  return true;
}

export async function createLobbyRoomFixtureForQa({ title, hostNickname, maxPlayers = 2, itemMode = false, stackedRollMode = false, playMode = 'individual', pieceCount = 4 } = {}) {
  const db = await getTestDb();
  if (!db) throw new Error('Firebase 설정이 없어 QA fixture 방을 생성할 수 없습니다.');
  const qaRunId = getQaRunId();
  if (!qaRunId) throw new Error('QA_RUN_ID 없이 QA fixture 방을 생성할 수 없습니다.');
  if (!testAuthUserId) throw new Error('QA fixture용 Firebase Auth 사용자가 없습니다.');
  const normalizedTitle = String(title ?? '').trim();
  if (!normalizedTitle) throw new Error('QA fixture 방 제목이 필요합니다.');
  const hostId = testAuthUserId;
  const nickname = String(hostNickname ?? 'QA Host').trim() || 'QA Host';
  const roomRef = doc(collection(db, 'rooms'));
  const fixtureTimestamp = Timestamp.now();
  const batch = writeBatch(db);
  batch.set(roomRef, {
    title: normalizedTitle,
    hostId,
    status: 'waiting',
    maxPlayers,
    itemMode: Boolean(itemMode),
    stackedRollMode: Boolean(stackedRollMode),
    playMode,
    pieceCount,
    currentPlayers: 1,
    createdAt: fixtureTimestamp,
    emptySince: null,
    isQaRoom: true,
    qaRunId,
    qaRole: getQaRole(),
    qaCreatedAt: fixtureTimestamp,
  });
  batch.set(doc(db, 'rooms', roomRef.id, 'players', hostId), {
    nickname,
    ready: true,
    color: '#2563eb',
    seatIndex: 0,
    team: '청팀',
    joinedAt: fixtureTimestamp,
    lastSeen: fixtureTimestamp,
  });
  batch.set(doc(db, 'rooms', roomRef.id, 'seats', '0'), {
    playerId: hostId,
    originalPlayerId: hostId,
    currentPlayerId: hostId,
    nickname,
    color: '#2563eb',
    team: '청팀',
    seatIndex: 0,
    label: 'P1',
    isHost: true,
    aiActive: false,
    status: 'human',
    createdAt: fixtureTimestamp,
    updatedAt: fixtureTimestamp,
  });
  await batch.commit();
  const committedRoom = await getDoc(roomRef);
  if (!committedRoom.exists() || !getTimestampMillis(committedRoom.data().createdAt)) {
    throw new Error(`QA fixture 방이 조회 가능한 상태로 저장되지 않았습니다: ${roomRef.id}`);
  }
  return roomRef.id;
}

export async function findRoomIdByTitle(title) {
  const db = await getTestDb();
  if (!db) return null;
  const snapshot = await getDocs(query(collection(db, 'rooms'), where('title', '==', title)));
  return snapshot.docs[0]?.id ?? null;
}

export async function getRoomForQa(roomId) {
  const db = await getTestDb();
  if (!db || !roomId) return null;
  const accessToken = roomAccessTokens.get(roomId);
  if (accessToken) return getRestDocument(['rooms', roomId], accessToken);
  const snapshot = await getDoc(doc(db, 'rooms', roomId));
  return snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null;
}

export async function getRoomStateForQa(roomId) {
  const db = await getTestDb();
  if (!db || !roomId) return null;
  const accessToken = roomAccessTokens.get(roomId);
  if (accessToken) return getRestDocument(['rooms', roomId, 'state', 'current'], accessToken);
  const snapshot = await getDoc(doc(db, 'rooms', roomId, 'state', 'current'));
  return snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null;
}

export async function updateRoomForQa(roomId, patch) {
  const db = await getTestDb();
  if (!db || !roomId) return false;
  const accessToken = roomAccessTokens.get(roomId);
  if (accessToken) await patchRestDocument(['rooms', roomId], patch, accessToken);
  else await updateDoc(doc(db, 'rooms', roomId), patch);
  return true;
}

export async function getRoomSequencesForQa(roomId) {
  const db = await getTestDb();
  if (!db || !roomId) return [];
  const accessToken = roomAccessTokens.get(roomId);
  if (accessToken) return listRestDocuments(['rooms', roomId], 'sequences', accessToken);
  const snapshot = await getDocs(collection(db, 'rooms', roomId, 'sequences'));
  return snapshot.docs.map((documentSnapshot) => ({ id: documentSnapshot.id, ...documentSnapshot.data() }));
}

export async function getRoomPlayersForQa(roomId) {
  const db = await getTestDb();
  if (!db || !roomId) return [];
  const accessToken = roomAccessTokens.get(roomId);
  if (accessToken) return listRestDocuments(['rooms', roomId], 'players', accessToken);
  const snapshot = await getDocs(collection(db, 'rooms', roomId, 'players'));
  return snapshot.docs.map((documentSnapshot) => ({ id: documentSnapshot.id, ...documentSnapshot.data() }));
}

export async function getRoomSeatsForQa(roomId) {
  const db = await getTestDb();
  if (!db || !roomId) return [];
  const accessToken = roomAccessTokens.get(roomId);
  if (accessToken) return listRestDocuments(['rooms', roomId], 'seats', accessToken);
  const snapshot = await getDocs(collection(db, 'rooms', roomId, 'seats'));
  return snapshot.docs.map((documentSnapshot) => ({ id: documentSnapshot.id, ...documentSnapshot.data() }));
}

async function deleteDocumentsInBatches(documentSnapshots) {
  const db = await getTestDb();
  if (!db || documentSnapshots.length === 0) return 0;
  let deletedCount = 0;
  for (let index = 0; index < documentSnapshots.length; index += roomDeleteBatchSize) {
    const batch = writeBatch(db);
    const batchSnapshots = documentSnapshots.slice(index, index + roomDeleteBatchSize);
    batchSnapshots.forEach((documentSnapshot) => batch.delete(documentSnapshot.ref));
    await batch.commit();
    deletedCount += batchSnapshots.length;
  }
  return deletedCount;
}

async function deleteRoomSubcollectionsForQa(roomId) {
  const db = await getTestDb();
  const deletedCounts = {};
  if (!db || !roomId) return deletedCounts;
  const accessToken = roomAccessTokens.get(roomId);
  if (accessToken) {
    for (const subcollectionName of roomSubcollections) {
      const documents = await listRestDocuments(['rooms', roomId], subcollectionName, accessToken);
      for (const document of documents) await deleteRestDocument(['rooms', roomId, subcollectionName, document.id], accessToken);
      if (documents.length > 0) deletedCounts[subcollectionName] = documents.length;
    }
    return deletedCounts;
  }
  for (const subcollectionName of roomSubcollections) {
    const snapshot = await getDocs(collection(db, 'rooms', roomId, subcollectionName));
    const deletedCount = await deleteDocumentsInBatches(snapshot.docs);
    if (deletedCount > 0) deletedCounts[subcollectionName] = deletedCount;
  }
  return deletedCounts;
}

export async function deleteRoomForQa(roomId) {
  const db = await getTestDb();
  if (!db || !roomId) return {};
  const accessToken = roomAccessTokens.get(roomId);
  const deletedCounts = await deleteRoomSubcollectionsForQa(roomId);
  if (accessToken) {
    await deleteRestDocument(['rooms', roomId], accessToken);
    roomAccessTokens.delete(roomId);
  } else {
    await deleteDoc(doc(db, 'rooms', roomId));
  }
  return deletedCounts;
}

export async function rememberRoomIdFromPage(page) {
  const roomId = await page.evaluate(() => String(window.__YUT_DEBUG_STATE__?.activeRoomId ?? ''));
  if (!roomId) return null;
  await getTestDb();
  const accessToken = await rememberRoomAccessToken(roomId, page);
  if (!accessToken) throw new Error(`방 ${roomId}의 Firebase Auth 토큰을 브라우저에서 확보하지 못했습니다.`);
  await markRoomForQa(roomId);
  return roomId;
}
