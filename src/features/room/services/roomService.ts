import { addDoc, collection, deleteDoc, doc, getDoc, getDocs, limit, onSnapshot, orderBy, query, runTransaction, serverTimestamp, setDoc, updateDoc, where, type Unsubscribe } from 'firebase/firestore';
import { db } from '../../../services/firebase/firebaseDb';
import { spawnInitialBoardItems, type BoardItem } from '../../../game-core/board/board';

export interface RoomSummary {
  id: string; title: string; hostId?: string; status: 'waiting' | 'playing' | 'finished'; maxPlayers: number; itemMode: boolean; playMode: 'individual' | 'team'; pieceCount: 1 | 2 | 3 | 4; createdAt?: unknown; emptySince?: number | null;
}

const getCreatedAtMillis = (createdAt: unknown) => {
  if (createdAt && typeof createdAt === 'object' && 'toMillis' in createdAt && typeof createdAt.toMillis === 'function') {
    return createdAt.toMillis();
  }
  if (createdAt instanceof Date) return createdAt.getTime();
  if (typeof createdAt === 'number') return createdAt;
  return 0;
};
export interface RoomPlayer { id: string; nickname: string; ready: boolean; color: string; seatIndex: number; team: '청팀' | '홍팀'; isAI?: boolean; isSpectator?: boolean; joinedAt?: unknown; lastSeen?: unknown; }
export interface SyncedGameState { pieces: unknown[]; turnIndex: number; turnOrderIds?: string[]; roll: unknown | null; boardItems: BoardItem[]; ownedItems: Record<string, unknown[]>; trapNodes: unknown[]; shieldedPieceIds: string[]; logs: unknown[]; winner: string; captureEffect?: unknown | null; trapEffect?: unknown | null; gameStartedAt?: number | null; turnOrderIntro?: unknown | null; updatedAt?: unknown; turnVersion: number; }

const COLORS = ['red', 'blue', 'green', 'yellow'];
const TEAMS: RoomPlayer['team'][] = ['청팀', '홍팀', '청팀', '홍팀'];
const MAX_ACTIVE_ROOMS = 3;
const EMPTY_ROOM_DELETE_DELAY_MS = 30000;
const STALE_PLAYER_DELETE_MS = 45000;

const getTimestampMillis = (value: unknown) => {
  if (value && typeof value === 'object' && 'toMillis' in value && typeof value.toMillis === 'function') {
    return value.toMillis();
  }
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  return 0;
};

export async function createRoom(params: { title: string; hostId: string; nickname: string; maxPlayers: 2|3|4; itemMode: boolean; playMode: 'individual'|'team'; pieceCount: 1|2|3|4; password?: string; }) {
  if (!db) throw new Error('Firebase 환경변수가 설정되지 않았습니다.');
  const firestore = db;
  const normalizedTitle = params.title.trim();
  if (!normalizedTitle) throw new Error('방 제목을 입력해주세요.');
  const roomsRef = collection(firestore, 'rooms');
  const existingHostRooms = await getDocs(query(roomsRef, where('hostId', '==', params.hostId)));
  await Promise.all(existingHostRooms.docs
    .filter((roomDoc) => ['waiting', 'finished'].includes(String(roomDoc.data().status)))
    .map((roomDoc) => deleteDoc(roomDoc.ref)));
  const activeRoomsSnapshot = await getDocs(query(roomsRef, where('status', 'in', ['waiting', 'playing'])));
  const activeRooms = activeRoomsSnapshot.docs.map((roomDoc) => roomDoc.data() as Omit<RoomSummary, 'id'>);
  if (activeRooms.length >= MAX_ACTIVE_ROOMS) throw new Error('방은 최대 3개까지만 만들 수 있습니다. 기존 방에 참여하거나 잠시 뒤 다시 시도해주세요.');
  if (activeRooms.some((room) => room.title.trim().toLocaleLowerCase() === normalizedTitle.toLocaleLowerCase())) throw new Error('이미 존재하는 방 제목입니다. 다른 제목을 입력해주세요.');
  const roomRef = await addDoc(roomsRef, {
    title: normalizedTitle,
    hostId: params.hostId,
    maxPlayers: params.maxPlayers,
    itemMode: params.itemMode,
    playMode: params.playMode,
    pieceCount: params.pieceCount,
    hasPassword: Boolean(params.password),
    passwordHint: params.password ? '설정됨' : '',
    status: 'waiting',
    emptySince: null,
    createdAt: serverTimestamp(),
  });
  await setDoc(doc(firestore, 'rooms', roomRef.id, 'players', params.hostId), { nickname: params.nickname, ready: true, color: COLORS[0], seatIndex: 0, team: '청팀', joinedAt: serverTimestamp(), lastSeen: serverTimestamp() });
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
  if (room.status === 'finished') throw new Error('이미 종료된 방입니다.');
  const playerRef = doc(db, 'rooms', roomId, 'players', params.userId);
  const existingPlayer = await getDoc(playerRef);
  if (existingPlayer.exists()) {
    await setDoc(playerRef, { nickname: params.nickname, lastSeen: serverTimestamp() }, { merge: true });
    await setDoc(doc(db, 'rooms', roomId), { emptySince: null }, { merge: true });
    return existingPlayer.data().isSpectator ? 'spectator' : 'player';
  }
  if (room.status === 'playing') {
    await setDoc(playerRef, { nickname: params.nickname, ready: true, color: 'spectator', seatIndex: 99 + Date.now() % 100000, team: '청팀', isSpectator: true, joinedAt: serverTimestamp(), lastSeen: serverTimestamp() }, { merge: true });
    await setDoc(doc(db, 'rooms', roomId), { emptySince: null }, { merge: true });
    return 'spectator';
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
    lastSeen: serverTimestamp(),
  }, { merge: true });
  await setDoc(doc(db, 'rooms', roomId), { emptySince: null }, { merge: true });
  return 'player';
}

export function subscribeRoomPlayers(roomId: string, callback: (players: RoomPlayer[]) => void): Unsubscribe {
  if (!db) { callback([]); return () => undefined; }
  return onSnapshot(query(collection(db, 'rooms', roomId, 'players'), orderBy('seatIndex', 'asc')), (snapshot) => callback(snapshot.docs.map((playerDoc) => ({ id: playerDoc.id, ...(playerDoc.data() as Omit<RoomPlayer, 'id'>) }))));
}


export async function heartbeatRoomPlayer(roomId: string, playerId: string) {
  if (!db || !roomId || !playerId) return;
  await setDoc(doc(db, 'rooms', roomId, 'players', playerId), { lastSeen: serverTimestamp() }, { merge: true });
}

export async function cleanupStaleRooms(staleMs = STALE_PLAYER_DELETE_MS, protectedRoomId = '') {
  if (!db) return;
  const now = Date.now();
  const activeRoomsSnapshot = await getDocs(query(collection(db, 'rooms'), where('status', 'in', ['waiting', 'playing'])));
  await Promise.all(activeRoomsSnapshot.docs.map(async (roomDoc) => {
    if (roomDoc.id === protectedRoomId) return;
    const playersRef = collection(db!, 'rooms', roomDoc.id, 'players');
    const playersSnapshot = await getDocs(playersRef);
    const stalePlayers = playersSnapshot.docs.filter((playerDoc) => {
      const player = playerDoc.data() as RoomPlayer;
      if (player.isAI) return false;
      const lastSeen = getTimestampMillis(player.lastSeen ?? player.joinedAt);
      return !lastSeen || now - lastSeen > staleMs;
    });
    await Promise.all(stalePlayers.map((playerDoc) => deleteDoc(playerDoc.ref)));
    const remainingHumans = playersSnapshot.docs.filter((playerDoc) => {
      if (stalePlayers.some((staleDoc) => staleDoc.id === playerDoc.id)) return false;
      const player = playerDoc.data() as RoomPlayer;
      return !player.isAI;
    });
    if (!remainingHumans.length) await deleteDoc(roomDoc.ref);
  }));
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

export function subscribeActiveRooms(callback: (rooms: RoomSummary[]) => void): Unsubscribe {
  if (!db) { callback([]); return () => undefined; }
  const roomsQuery = query(collection(db, 'rooms'), where('status', 'in', ['waiting', 'playing']));
  return onSnapshot(roomsQuery, (snapshot) => {
    const rooms = snapshot.docs
      .map((roomDoc) => ({ id: roomDoc.id, ...(roomDoc.data() as Omit<RoomSummary, 'id'>) }))
      .sort((a, b) => getCreatedAtMillis(b.createdAt) - getCreatedAtMillis(a.createdAt));
    callback(rooms);
  }, () => callback([]));
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

async function deleteRoomIfStillEmpty(roomId: string, expectedEmptySince: number) {
  if (!db) return;
  const roomRef = doc(db, 'rooms', roomId);
  const roomSnapshot = await getDoc(roomRef);
  if (!roomSnapshot.exists()) return;
  const playersSnapshot = await getDocs(query(collection(db, 'rooms', roomId, 'players'), limit(1)));
  const room = roomSnapshot.data() as Omit<RoomSummary, 'id'>;
  if (playersSnapshot.empty && Number(room.emptySince ?? 0) === expectedEmptySince) await deleteDoc(roomRef);
}

export async function scheduleEmptyRoomDeletion(roomId: string) {
  if (!db) return;
  const playersSnapshot = await getDocs(query(collection(db, 'rooms', roomId, 'players'), limit(1)));
  const roomRef = doc(db, 'rooms', roomId);
  if (!playersSnapshot.empty) {
    await setDoc(roomRef, { emptySince: null }, { merge: true });
    return;
  }
  const emptySince = Date.now();
  await setDoc(roomRef, { emptySince }, { merge: true });
  window.setTimeout(() => { void deleteRoomIfStillEmpty(roomId, emptySince); }, EMPTY_ROOM_DELETE_DELAY_MS);
}

export async function removeRoomPlayer(roomId: string, playerId: string) {
  if (!db) throw new Error('Firebase 환경변수가 설정되지 않았습니다.');
  const roomRef = doc(db, 'rooms', roomId);
  const roomSnapshot = await getDoc(roomRef);
  await deleteDoc(doc(db, 'rooms', roomId, 'players', playerId));
  const remainingPlayersSnapshot = await getDocs(query(collection(db, 'rooms', roomId, 'players'), orderBy('seatIndex', 'asc'), limit(1)));
  if (remainingPlayersSnapshot.empty) {
    await scheduleEmptyRoomDeletion(roomId);
    return;
  }
  const room = roomSnapshot.exists() ? roomSnapshot.data() as Omit<RoomSummary, 'id'> : null;
  await setDoc(roomRef, { emptySince: null, ...(room?.hostId === playerId ? { hostId: remainingPlayersSnapshot.docs[0].id } : {}) }, { merge: true });
}

export async function updateRoomStatus(roomId: string, status: RoomSummary['status']) {
  if (!db) throw new Error('Firebase 환경변수가 설정되지 않았습니다.');
  await updateDoc(doc(db, 'rooms', roomId), { status });
}

export async function deleteRoom(roomId: string) {
  if (!db) return;
  await deleteDoc(doc(db, 'rooms', roomId));
}
