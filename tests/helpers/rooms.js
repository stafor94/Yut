import { initializeApp, getApps } from 'firebase/app';
import { collection, deleteDoc, doc, getDocs, getFirestore, query, where, writeBatch } from 'firebase/firestore';
import { loadFirebaseConfig } from './env.js';

const roomSubcollections = ['actions', 'boardItems', 'players', 'seats', 'state', 'sequences', 'processedActions'];
const inactiveRoomMaxAgeMs = 60 * 60 * 1000;
const roomDeleteBatchSize = 25;
let dbPromise;

function getTimestampMillis(value) {
  if (value && typeof value === 'object' && typeof value.toMillis === 'function') return value.toMillis();
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  return 0;
}

export function isInactiveRoom(room, now = Date.now()) {
  const createdAt = getTimestampMillis(room.createdAt);
  const expired = Boolean(createdAt && now - createdAt > inactiveRoomMaxAgeMs);
  const emptyGhost = room.currentPlayers !== undefined && Number(room.currentPlayers) <= 0;
  return room.status === 'finished' || expired || emptyGhost;
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

export async function deleteRoomForQa(roomId) {
  const db = await getTestDb();
  if (!db || !roomId) return;
  for (const subcollectionName of roomSubcollections) {
    const snapshot = await getDocs(collection(db, 'rooms', roomId, subcollectionName));
    for (let index = 0; index < snapshot.docs.length; index += roomDeleteBatchSize) {
      const batch = writeBatch(db);
      snapshot.docs.slice(index, index + roomDeleteBatchSize).forEach((documentSnapshot) => batch.delete(documentSnapshot.ref));
      await batch.commit();
    }
  }
  await deleteDoc(doc(db, 'rooms', roomId));
}

export async function deleteInactiveRoomsForQa() {
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
    await deleteRoomForQa(room.id);
  }
  return inactiveRooms;
}

export async function rememberRoomIdFromPage(page) {
  const roomId = await page.evaluate(() => String(window.__YUT_DEBUG_STATE__?.activeRoomId ?? ''));
  return roomId || null;
}
