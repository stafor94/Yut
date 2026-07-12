import { initializeApp, getApps } from 'firebase/app';
import { Timestamp, collection, connectFirestoreEmulator, deleteDoc, doc, getDoc, getDocs, getFirestore, query, serverTimestamp, updateDoc, where, writeBatch } from 'firebase/firestore';
import { loadFirebaseConfig } from './env.js';

const roomSubcollections = ['actions', 'boardItems', 'players', 'rooms', 'seats', 'state', 'sequences', 'processedActions'];
const oldRoomMaxAgeMs = 2 * 60 * 60 * 1000;
const roomDeleteBatchSize = 25;
let dbPromise;

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

export async function getTestDb() {
  if (!dbPromise) {
    dbPromise = (async () => {
      const config = await loadFirebaseConfig();
      if (!config) return null;
      const qaRunId = String(process.env.QA_RUN_ID ?? '').trim();
      const emulatorEndpoint = String(process.env.FIRESTORE_EMULATOR_HOST ?? '').trim();
      if (qaRunId && !emulatorEndpoint) throw new Error('QA helper는 FIRESTORE_EMULATOR_HOST 없이 실행할 수 없습니다.');
      if (qaRunId && !String(config.projectId ?? '').startsWith('demo-')) throw new Error(`QA helper가 운영 projectId를 거부했습니다: ${String(config.projectId ?? '')}`);
      const appName = qaRunId ? `qa-${qaRunId}`.slice(0, 40) : 'qa-helper';
      const app = getApps().find((candidate) => candidate.name === appName) ?? initializeApp(config, appName);
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


export async function createLobbyRoomFixtureForQa({ title, hostNickname, maxPlayers = 2, itemMode = false, stackedRollMode = false, playMode = 'individual', pieceCount = 4 } = {}) {
  const db = await getTestDb();
  if (!db) throw new Error('Firebase 설정이 없어 QA fixture 방을 생성할 수 없습니다.');
  const qaRunId = String(process.env.QA_RUN_ID ?? '').trim();
  if (!qaRunId) throw new Error('QA_RUN_ID 없이 QA fixture 방을 생성할 수 없습니다.');
  const normalizedTitle = String(title ?? '').trim();
  if (!normalizedTitle) throw new Error('QA fixture 방 제목이 필요합니다.');
  const hostId = `qa-fixture-host-${qaRunId}-${Math.random().toString(36).slice(2, 10)}`;
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
    qaRunId,
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
  const snapshot = await getDoc(doc(db, 'rooms', roomId));
  return snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null;
}

export async function getRoomStateForQa(roomId) {
  const db = await getTestDb();
  if (!db || !roomId) return null;
  const snapshot = await getDoc(doc(db, 'rooms', roomId, 'state', 'current'));
  return snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null;
}


export async function updateRoomForQa(roomId, patch) {
  const db = await getTestDb();
  if (!db || !roomId) return false;
  await updateDoc(doc(db, 'rooms', roomId), patch);
  return true;
}

export async function getRoomSequencesForQa(roomId) {
  const db = await getTestDb();
  if (!db || !roomId) return [];
  const snapshot = await getDocs(collection(db, 'rooms', roomId, 'sequences'));
  return snapshot.docs.map((documentSnapshot) => ({ id: documentSnapshot.id, ...documentSnapshot.data() }));
}

export async function getRoomPlayersForQa(roomId) {
  const db = await getTestDb();
  if (!db || !roomId) return [];
  const snapshot = await getDocs(collection(db, 'rooms', roomId, 'players'));
  return snapshot.docs.map((documentSnapshot) => ({ id: documentSnapshot.id, ...documentSnapshot.data() }));
}

export async function getRoomSeatsForQa(roomId) {
  const db = await getTestDb();
  if (!db || !roomId) return [];
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
  const deletedCounts = await deleteRoomSubcollectionsForQa(roomId);
  await deleteDoc(doc(db, 'rooms', roomId));
  return deletedCounts;
}


export async function rememberRoomIdFromPage(page) {
  const roomId = await page.evaluate(() => String(window.__YUT_DEBUG_STATE__?.activeRoomId ?? ''));
  return roomId || null;
}
