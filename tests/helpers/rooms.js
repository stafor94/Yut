import { initializeApp, getApps } from 'firebase/app';
import { collection, collectionGroup, deleteDoc, doc, getDoc, getDocs, getFirestore, query, updateDoc, where, writeBatch } from 'firebase/firestore';
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
      const app = getApps().find((candidate) => candidate.name === 'qa-cleanup') ?? initializeApp(config, 'qa-cleanup');
      return getFirestore(app);
    })();
  }
  return dbPromise;
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

export async function deleteMissingParentRoomSubcollectionsForQa() {
  const db = await getTestDb();
  if (!db) return [];
  const candidateRoomIds = new Set();
  for (const subcollectionName of roomSubcollections) {
    const snapshot = await getDocs(collectionGroup(db, subcollectionName));
    snapshot.docs.forEach((documentSnapshot) => {
      const roomDocRef = documentSnapshot.ref.parent.parent;
      if (roomDocRef?.parent.id === 'rooms') candidateRoomIds.add(roomDocRef.id);
    });
  }

  const deletedRoomIds = [];
  for (const roomId of candidateRoomIds) {
    const roomSnapshot = await getDoc(doc(db, 'rooms', roomId));
    if (roomSnapshot.exists()) continue;
    const deletedCounts = await deleteRoomSubcollectionsForQa(roomId);
    deletedRoomIds.push({ id: roomId, deletedCounts });
  }
  return deletedRoomIds;
}

export async function deleteInactiveRoomsForQa(onFailure) {
  const db = await getTestDb();
  if (!db) return [];
  const now = Date.now();
  const snapshot = await getDocs(collection(db, 'rooms'));
  const inactiveRooms = snapshot.docs
    .map((documentSnapshot) => ({
      id: documentSnapshot.id,
      title: String(documentSnapshot.data().title ?? ''),
      data: documentSnapshot.data(),
    }))
    .filter((room) => isInactiveRoom(room.data, now));

  for (const room of inactiveRooms) {
    try {
      await deleteRoomForQa(room.id);
    } catch (error) {
      if (onFailure) onFailure(room, error);
      else throw error;
    }
  }
  return inactiveRooms;
}

export async function rememberRoomIdFromPage(page) {
  const roomId = await page.evaluate(() => String(window.__YUT_DEBUG_STATE__?.activeRoomId ?? ''));
  return roomId || null;
}
