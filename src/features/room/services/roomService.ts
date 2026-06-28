import { addDoc, collection, deleteDoc, doc, getDoc, getDocs, limit, onSnapshot, orderBy, query, runTransaction, serverTimestamp, setDoc, updateDoc, where, type Unsubscribe } from 'firebase/firestore';
import { db } from '../../../services/firebase/firebaseDb';
import { spawnInitialBoardItems, type BoardItem } from '../../../game-core/board/board';

export interface RoomSummary {
  id: string; title: string; status: 'waiting' | 'playing' | 'finished'; maxPlayers: number; itemMode: boolean; playMode: 'individual' | 'team'; pieceCount: 1 | 2 | 3 | 4; createdAt?: unknown;
}
export interface RoomPlayer { id: string; nickname: string; ready: boolean; color: string; seatIndex: number; team: '청팀' | '홍팀'; isAI?: boolean; joinedAt?: unknown; }
export interface SyncedGameState { pieces: unknown[]; turnIndex: number; turnOrderIds?: string[]; roll: unknown | null; boardItems: BoardItem[]; ownedItems: Record<string, unknown[]>; trapNodes: unknown[]; shieldedPieceIds: string[]; logs: unknown[]; winner: string; captureEffect?: unknown | null; updatedAt?: unknown; turnVersion: number; }

const COLORS = ['red', 'blue', 'green', 'yellow'];
const TEAMS: RoomPlayer['team'][] = ['청팀', '홍팀', '청팀', '홍팀'];

export async function createRoom(params: { title: string; hostId: string; nickname: string; maxPlayers: 2|3|4; itemMode: boolean; playMode: 'individual'|'team'; pieceCount: 1|2|3|4; password?: string; }) {
  if (!db) throw new Error('Firebase 환경변수가 설정되지 않았습니다.');
  const firestore = db;
  const existingHostRooms = await getDocs(query(collection(firestore, 'rooms'), where('hostId', '==', params.hostId)));
  await Promise.all(existingHostRooms.docs
    .filter((roomDoc) => ['waiting', 'finished'].includes(String(roomDoc.data().status)))
    .map((roomDoc) => deleteDoc(roomDoc.ref)));
  const roomRef = await addDoc(collection(firestore, 'rooms'), {
    title: params.title,
    hostId: params.hostId,
    maxPlayers: params.maxPlayers,
    itemMode: params.itemMode,
    playMode: params.playMode,
    pieceCount: params.pieceCount,
    hasPassword: Boolean(params.password),
    passwordHint: params.password ? '설정됨' : '',
    status: 'waiting',
    createdAt: serverTimestamp(),
  });
  await setDoc(doc(firestore, 'rooms', roomRef.id, 'players', params.hostId), { nickname: params.nickname, ready: true, color: COLORS[0], seatIndex: 0, team: '청팀', joinedAt: serverTimestamp() });
  if (params.itemMode) {
    await Promise.all(spawnInitialBoardItems().map((item) => setDoc(doc(firestore, 'rooms', roomRef.id, 'boardItems', item.id), item)));
  }
  return roomRef.id;
}

export async function joinRoom(roomId: string, params: { userId: string; nickname: string; playMode: 'individual'|'team'; }) {
  if (!db) throw new Error('Firebase 환경변수가 설정되지 않았습니다.');
  const roomSnapshot = await getDoc(doc(db, 'rooms', roomId));
  if (!roomSnapshot.exists()) throw new Error('존재하지 않는 방입니다.');
  const room = roomSnapshot.data() as Omit<RoomSummary, 'id'>;
  if (room.status !== 'waiting') throw new Error('이미 시작되었거나 종료된 방입니다.');
  const playerRef = doc(db, 'rooms', roomId, 'players', params.userId);
  const existingPlayer = await getDoc(playerRef);
  if (existingPlayer.exists()) {
    await setDoc(playerRef, { nickname: params.nickname }, { merge: true });
    return;
  }
  const playersRef = collection(db, 'rooms', roomId, 'players');
  const snapshot = await getDocs(query(playersRef, orderBy('seatIndex', 'asc'), limit(4)));
  const usedSeats = new Set(snapshot.docs.map((playerDoc) => Number(playerDoc.data().seatIndex)));
  let seatIndex = 0;
  while (usedSeats.has(seatIndex) && seatIndex < room.maxPlayers) seatIndex += 1;
  if (seatIndex >= room.maxPlayers) throw new Error('방이 가득 찼습니다.');
  await setDoc(playerRef, {
    nickname: params.nickname,
    ready: false,
    color: COLORS[seatIndex] ?? 'black',
    seatIndex,
    team: params.playMode === 'team' ? TEAMS[seatIndex] : '청팀',
    joinedAt: serverTimestamp(),
  }, { merge: true });
}

export function subscribeRoomPlayers(roomId: string, callback: (players: RoomPlayer[]) => void): Unsubscribe {
  if (!db) { callback([]); return () => undefined; }
  return onSnapshot(query(collection(db, 'rooms', roomId, 'players'), orderBy('seatIndex', 'asc')), (snapshot) => callback(snapshot.docs.map((playerDoc) => ({ id: playerDoc.id, ...(playerDoc.data() as Omit<RoomPlayer, 'id'>) }))));
}

export async function saveGameState(roomId: string, state: Omit<SyncedGameState, 'updatedAt' | 'turnVersion'>) {
  if (!db || !roomId) return;
  const gameStateRef = doc(db, 'rooms', roomId, 'state', 'current');
  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(gameStateRef);
    const currentVersion = snapshot.exists() ? Number(snapshot.data().turnVersion ?? 0) : 0;
    transaction.set(gameStateRef, { ...state, updatedAt: serverTimestamp(), turnVersion: currentVersion + 1 }, { merge: true });
  });
}

export function subscribeGameState(roomId: string, callback: (state: SyncedGameState | null) => void): Unsubscribe {
  if (!db) { callback(null); return () => undefined; }
  return onSnapshot(doc(db, 'rooms', roomId, 'state', 'current'), (snapshot) => callback(snapshot.exists() ? snapshot.data() as SyncedGameState : null));
}

export function subscribeWaitingRooms(callback: (rooms: RoomSummary[]) => void): Unsubscribe {
  if (!db) { callback([]); return () => undefined; }
  const roomsQuery = query(collection(db, 'rooms'), where('status', '==', 'waiting'), orderBy('createdAt', 'desc'));
  return onSnapshot(roomsQuery, (snapshot) => callback(snapshot.docs.map((roomDoc) => ({ id: roomDoc.id, ...(roomDoc.data() as Omit<RoomSummary, 'id'>) }))));
}

export function subscribeRoom(roomId: string, callback: (room: RoomSummary | null) => void): Unsubscribe {
  if (!db) { callback(null); return () => undefined; }
  return onSnapshot(doc(db, 'rooms', roomId), (snapshot) => {
    callback(snapshot.exists() ? { id: snapshot.id, ...(snapshot.data() as Omit<RoomSummary, 'id'>) } : null);
  });
}

export async function updateRoomOptions(roomId: string, params: Partial<Pick<RoomSummary, 'itemMode' | 'pieceCount' | 'playMode' | 'maxPlayers'>>) {
  if (!db) throw new Error('Firebase 환경변수가 설정되지 않았습니다.');
  await updateDoc(doc(db, 'rooms', roomId), params);
}

export async function updateRoomPlayer(roomId: string, playerId: string, params: Partial<Omit<RoomPlayer, 'id'>>) {
  if (!db) throw new Error('Firebase 환경변수가 설정되지 않았습니다.');
  await setDoc(doc(db, 'rooms', roomId, 'players', playerId), params, { merge: true });
}

export async function removeRoomPlayer(roomId: string, playerId: string) {
  if (!db) throw new Error('Firebase 환경변수가 설정되지 않았습니다.');
  await deleteDoc(doc(db, 'rooms', roomId, 'players', playerId));
}

export async function updateRoomStatus(roomId: string, status: RoomSummary['status']) {
  if (!db) throw new Error('Firebase 환경변수가 설정되지 않았습니다.');
  await updateDoc(doc(db, 'rooms', roomId), { status });
}

export async function deleteRoom(roomId: string) {
  if (!db) return;
  await deleteDoc(doc(db, 'rooms', roomId));
}
