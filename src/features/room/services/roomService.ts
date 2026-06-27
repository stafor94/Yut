import { addDoc, collection, doc, onSnapshot, orderBy, query, serverTimestamp, setDoc, where, type Unsubscribe } from 'firebase/firestore';
import { db } from '../../../services/firebase/firebaseDb';
import { spawnInitialBoardItems } from '../../../game-core/board/board';

export interface RoomSummary {
  id: string; title: string; status: 'waiting' | 'playing' | 'finished'; maxPlayers: number; itemMode: boolean; playMode: 'individual' | 'team'; createdAt?: unknown;
}

export async function createRoom(params: { title: string; hostId: string; nickname: string; maxPlayers: 1|2|3|4; itemMode: boolean; playMode: 'individual'|'team'; password?: string; }) {
  if (!db) throw new Error('Firebase 환경변수가 설정되지 않았습니다.');
  const firestore = db;
  const roomRef = await addDoc(collection(firestore, 'rooms'), {
    title: params.title,
    hostId: params.hostId,
    maxPlayers: params.maxPlayers,
    itemMode: params.itemMode,
    playMode: params.playMode,
    hasPassword: Boolean(params.password),
    passwordHint: params.password ? '설정됨' : '',
    status: 'waiting',
    createdAt: serverTimestamp(),
  });
  await setDoc(doc(firestore, 'rooms', roomRef.id, 'players', params.hostId), { nickname: params.nickname, ready: true, color: 'red', joinedAt: serverTimestamp() });
  if (params.itemMode) {
    await Promise.all(spawnInitialBoardItems().map((item) => setDoc(doc(firestore, 'rooms', roomRef.id, 'boardItems', item.id), item)));
  }
  return roomRef.id;
}

export function subscribeWaitingRooms(callback: (rooms: RoomSummary[]) => void): Unsubscribe {
  if (!db) { callback([]); return () => undefined; }
  const roomsQuery = query(collection(db, 'rooms'), where('status', '==', 'waiting'), orderBy('createdAt', 'desc'));
  return onSnapshot(roomsQuery, (snapshot) => callback(snapshot.docs.map((roomDoc) => ({ id: roomDoc.id, ...(roomDoc.data() as Omit<RoomSummary, 'id'>) }))));
}
