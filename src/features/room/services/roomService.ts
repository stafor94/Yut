import { addDoc, collection, deleteDoc, doc, getDoc, getDocs, limit, onSnapshot, orderBy, query, runTransaction, serverTimestamp, setDoc, updateDoc, where, writeBatch, type DocumentReference, type Unsubscribe } from 'firebase/firestore';
import { db } from '../../../services/firebase/firebaseDb';
import { spawnInitialBoardItems, type BoardItem, type BranchChoice } from '../../../game-core/board/board';
import { rollYutResult, type YutResult } from '../../../game-core/roll';
import { reduceMoveCommand, reduceRollCommand, type EngineState } from '../../../game-core/gameEngine';

export interface RoomSummary {
  id: string; title: string; hostId?: string; status: 'waiting' | 'playing' | 'finished'; maxPlayers: number; itemMode: boolean; playMode: 'individual' | 'team'; pieceCount: 1 | 2 | 3 | 4; createdAt?: unknown; emptySince?: number | null; currentPlayers?: number;
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
export interface SyncedGameState { pieces: unknown[]; turnIndex: number; turnOrderIds?: string[]; roll: unknown | null; rollAnimation?: unknown | null; boardItems: BoardItem[]; ownedItems: Record<string, unknown[]>; trapNodes: unknown[]; shieldedPieceIds: string[]; logs: unknown[]; winner: string; captureEffect?: unknown | null; trapEffect?: unknown | null; gameStartedAt?: number | null; turnOrderIntro?: unknown | null; pendingTrapPlacement?: unknown | null; rollLockUntil?: number; lastMovedPieceIds?: string[]; lastMovedSeatId?: string; itemPromptTiming?: unknown | null; branchChoice?: unknown; rollResultReadyAt?: number; turnOrderPhase?: unknown | null; updatedAt?: unknown; turnVersion: number; lastSequence?: number; lastClientMutationId?: string; }
export type GameStatePatch = Partial<Omit<SyncedGameState, 'updatedAt' | 'turnVersion'>>;
export interface GameAction { id: string; type: 'turn_order_roll' | 'roll_yut' | 'move_piece' | 'use_item' | 'place_trap'; actorId: string; payload?: Record<string, unknown>; createdAt?: unknown; processed?: boolean; }
export type GameSequenceType = 'state_snapshot' | 'game_initialized' | 'turn_order_roll' | 'turn_order_resolved' | 'turn_order_intro_completed' | 'roll_yut' | 'move_piece_resolved' | 'item_used' | 'trap_placed' | 'game_finished';
export interface GameSequence { id: string; sequence: number; type: GameSequenceType; actorId: string; payload?: Record<string, unknown>; expectedPreviousSequence?: number; clientMutationId?: string; createdAt?: unknown; clientCreatedAt?: number; }
export type GameSequenceMeta = { type?: GameSequenceType; actorId?: string; payload?: Record<string, unknown>; clientMutationId?: string; clientCreatedAt?: number; expectedPreviousSequence?: number };

const COLORS = ['red', 'blue', 'green', 'yellow'];
const TEAMS: RoomPlayer['team'][] = ['청팀', '홍팀', '청팀', '홍팀'];
const MAX_ACTIVE_ROOMS = 3;
const EMPTY_ROOM_DELETE_DELAY_MS = 30000;
const STALE_PLAYER_DELETE_MS = 45000;
const ROOM_MAX_AGE_MS = 60 * 60 * 1000;
const ROOM_SUBCOLLECTIONS = ['actions', 'boardItems', 'players', 'seats', 'state', 'sequences', 'processedActions'] as const;
const DELETE_BATCH_SIZE = 450;
const SEQUENCE_ID_PAD_LENGTH = 12;

const getTimestampMillis = (value: unknown) => {
  if (value && typeof value === 'object' && 'toMillis' in value && typeof value.toMillis === 'function') {
    return value.toMillis();
  }
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  return 0;
};

type PlayerRoomMembership = { room: RoomSummary; player: RoomPlayer; joinedAt: number };

async function getActivePlayerRoomMemberships(playerId: string): Promise<PlayerRoomMembership[]> {
  if (!db || !playerId) return [];
  const roomsSnapshot = await getDocs(query(collection(db, 'rooms'), where('status', 'in', ['waiting', 'playing'])));
  const memberships = await Promise.all(roomsSnapshot.docs.map(async (roomDoc) => {
    const playerSnapshot = await getDoc(doc(db!, 'rooms', roomDoc.id, 'players', playerId));
    if (!playerSnapshot.exists()) return null;
    const player = { id: playerSnapshot.id, ...(playerSnapshot.data() as Omit<RoomPlayer, 'id'>) };
    const joinedAt = getTimestampMillis(player.joinedAt) || getTimestampMillis(player.lastSeen) || getCreatedAtMillis((roomDoc.data() as Omit<RoomSummary, 'id'>).createdAt);
    return { room: { id: roomDoc.id, ...(roomDoc.data() as Omit<RoomSummary, 'id'>) }, player, joinedAt };
  }));
  return memberships.filter((membership): membership is PlayerRoomMembership => Boolean(membership));
}

export async function leaveDuplicatePlayerRooms(playerId: string, keepRoomId = '') {
  if (!db || !playerId) return [];
  const memberships = await getActivePlayerRoomMemberships(playerId);
  if (memberships.length < 2 && !keepRoomId) return [];
  const sortedMemberships = [...memberships].sort((left, right) => right.joinedAt - left.joinedAt);
  const selectedKeepRoomId = keepRoomId || sortedMemberships[0]?.room.id || '';
  const roomsToLeave = memberships.filter((membership) => membership.room.id !== selectedKeepRoomId);
  await Promise.all(roomsToLeave.map(async ({ room }) => {
    if (room.hostId === playerId) await deleteRoom(room.id);
    else await removeRoomPlayer(room.id, playerId);
  }));
  return roomsToLeave.map(({ room }) => room.id);
}

export async function createRoom(params: { title: string; hostId: string; nickname: string; maxPlayers: 2|3|4; itemMode: boolean; playMode: 'individual'|'team'; pieceCount: 1|2|3|4; password?: string; }) {
  if (!db) throw new Error('Firebase 환경변수가 설정되지 않았습니다.');
  const firestore = db;
  const normalizedTitle = params.title.trim();
  if (!normalizedTitle) throw new Error('방 제목을 입력해주세요.');
  const roomsRef = collection(firestore, 'rooms');
  const now = Date.now();
  const existingHostRooms = await getDocs(query(roomsRef, where('hostId', '==', params.hostId)));
  const staleHostRoomRefs = existingHostRooms.docs
    .filter((roomDoc) => ['waiting', 'playing', 'finished'].includes(String(roomDoc.data().status)))
    .map((roomDoc) => roomDoc.ref);
  if (staleHostRoomRefs.length) {
    const cleanupBatch = writeBatch(firestore);
    staleHostRoomRefs.forEach((roomRef) => cleanupBatch.set(roomRef, { status: 'finished', emptySince: now }, { merge: true }));
    await cleanupBatch.commit();
    staleHostRoomRefs.forEach((roomRef) => { void deleteRoom(roomRef.id); });
  }

  const activeRoomsSnapshot = await getDocs(query(roomsRef, where('status', 'in', ['waiting', 'playing'])));
  const activeRoomDocs = activeRoomsSnapshot.docs.filter((roomDoc) => {
    const room = roomDoc.data() as Omit<RoomSummary, 'id'>;
    const createdAt = getCreatedAtMillis(room.createdAt);
    const expired = Boolean(createdAt && now - createdAt > ROOM_MAX_AGE_MS);
    const emptyGhost = room.currentPlayers !== undefined && Number(room.currentPlayers) <= 0;
    if (expired || emptyGhost) void deleteRoom(roomDoc.id);
    return !expired && !emptyGhost;
  });
  const activeRooms = activeRoomDocs.map((roomDoc) => roomDoc.data() as Omit<RoomSummary, 'id'>);
  if (activeRooms.length >= MAX_ACTIVE_ROOMS) throw new Error('방은 최대 3개까지만 만들 수 있습니다. 기존 방에 참여하거나 잠시 뒤 다시 시도해주세요.');
  if (activeRooms.some((room) => room.title.trim().toLocaleLowerCase() === normalizedTitle.toLocaleLowerCase())) throw new Error('이미 존재하는 방 제목입니다. 다른 제목을 입력해주세요.');

  const roomRef = doc(roomsRef);
  const createBatch = writeBatch(firestore);
  createBatch.set(roomRef, {
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
    currentPlayers: 1,
    createdAt: serverTimestamp(),
  });
  createBatch.set(doc(firestore, 'rooms', roomRef.id, 'players', params.hostId), { nickname: params.nickname, ready: true, color: COLORS[0], seatIndex: 0, team: '청팀', joinedAt: serverTimestamp(), lastSeen: serverTimestamp() });
  createBatch.set(doc(firestore, 'rooms', roomRef.id, 'seats', '0'), { playerId: params.hostId, updatedAt: serverTimestamp() });
  if (params.itemMode) {
    spawnInitialBoardItems().forEach((item) => createBatch.set(doc(firestore, 'rooms', roomRef.id, 'boardItems', item.id), item));
  }
  await createBatch.commit();
  return roomRef.id;
}


async function syncRoomPlayerCount(roomId: string) {
  if (!db) return;
  const playersSnapshot = await getDocs(collection(db, 'rooms', roomId, 'players'));
  const currentPlayers = playersSnapshot.docs.filter((playerDoc) => !(playerDoc.data() as RoomPlayer).isSpectator).length;
  await setDoc(doc(db, 'rooms', roomId), { currentPlayers }, { merge: true });
}

export type JoinRoomResult = { role: 'player' | 'spectator'; seatIndex: number | null };

export async function joinRoom(roomId: string, params: { userId: string; nickname: string; playMode: 'individual'|'team'; }): Promise<JoinRoomResult> {
  if (!db) throw new Error('Firebase 환경변수가 설정되지 않았습니다.');
  const roomRef = doc(db, 'rooms', roomId);
  const playerRef = doc(db, 'rooms', roomId, 'players', params.userId);
  return runTransaction(db, async (transaction) => {
    const roomSnapshot = await transaction.get(roomRef);
    if (!roomSnapshot.exists()) throw new Error('존재하지 않는 방입니다.');
    const room = roomSnapshot.data() as Omit<RoomSummary, 'id'>;
    if (room.status === 'finished') throw new Error('이미 종료된 방입니다.');

    const existingPlayer = await transaction.get(playerRef);
    if (existingPlayer.exists()) {
      const existingData = existingPlayer.data() as RoomPlayer;
      const existingSeatIndex = Number(existingData.seatIndex);
      const hasValidActiveSeat = !existingData.isSpectator && Number.isInteger(existingSeatIndex) && existingSeatIndex >= 0 && existingSeatIndex < Number(room.maxPlayers);
      if (existingData.isSpectator || hasValidActiveSeat) {
        transaction.set(playerRef, { nickname: params.nickname, lastSeen: serverTimestamp() }, { merge: true });
        if (hasValidActiveSeat) transaction.set(doc(db!, 'rooms', roomId, 'seats', String(existingSeatIndex)), { playerId: params.userId, updatedAt: serverTimestamp() }, { merge: true });
        transaction.set(roomRef, { emptySince: null }, { merge: true });
        return { role: existingData.isSpectator ? 'spectator' : 'player', seatIndex: existingData.isSpectator ? null : existingSeatIndex };
      }

      const maxPlayers = room.maxPlayers as 2 | 3 | 4;
      const seatRefs = Array.from({ length: maxPlayers }, (_, index) => doc(db!, 'rooms', roomId, 'seats', String(index)));
      const seatSnapshots = await Promise.all(seatRefs.map((seatRef) => transaction.get(seatRef)));
      const currentPlayers = seatSnapshots.filter((seatSnapshot) => seatSnapshot.exists()).length;

      if (room.status === 'playing') {
        transaction.set(playerRef, { nickname: params.nickname, ready: true, color: 'spectator', seatIndex: 99 + Date.now() % 100000, team: '청팀', isSpectator: true, joinedAt: existingData.joinedAt ?? serverTimestamp(), lastSeen: serverTimestamp() }, { merge: true });
        transaction.set(roomRef, { emptySince: null, currentPlayers }, { merge: true });
        return { role: 'spectator', seatIndex: null };
      }

      const seatIndex = seatSnapshots.findIndex((seatSnapshot) => !seatSnapshot.exists());
      if (seatIndex < 0) throw new Error('방이 가득 찼습니다.');
      transaction.set(playerRef, {
        nickname: params.nickname,
        ready: false,
        color: COLORS[seatIndex] ?? 'black',
        seatIndex,
        team: params.playMode === 'team' ? TEAMS[seatIndex] : '청팀',
        isSpectator: false,
        joinedAt: existingData.joinedAt ?? serverTimestamp(),
        lastSeen: serverTimestamp(),
      }, { merge: true });
      transaction.set(seatRefs[seatIndex], { playerId: params.userId, updatedAt: serverTimestamp() });
      transaction.set(roomRef, { emptySince: null, currentPlayers: currentPlayers + 1 }, { merge: true });
      return { role: 'player', seatIndex };
    }

    const maxPlayers = room.maxPlayers as 2 | 3 | 4;
    const seatRefs = Array.from({ length: maxPlayers }, (_, index) => doc(db!, 'rooms', roomId, 'seats', String(index)));
    const seatSnapshots = await Promise.all(seatRefs.map((seatRef) => transaction.get(seatRef)));
    const currentPlayers = seatSnapshots.filter((seatSnapshot) => seatSnapshot.exists()).length;

    if (room.status === 'playing') {
      transaction.set(playerRef, { nickname: params.nickname, ready: true, color: 'spectator', seatIndex: 99 + Date.now() % 100000, team: '청팀', isSpectator: true, joinedAt: serverTimestamp(), lastSeen: serverTimestamp() }, { merge: true });
      transaction.set(roomRef, { emptySince: null, currentPlayers }, { merge: true });
      return { role: 'spectator', seatIndex: null };
    }

    const seatIndex = seatSnapshots.findIndex((seatSnapshot) => !seatSnapshot.exists());
    if (seatIndex < 0) throw new Error('방이 가득 찼습니다.');

    transaction.set(playerRef, {
      nickname: params.nickname,
      ready: false,
      color: COLORS[seatIndex] ?? 'black',
      seatIndex,
      team: params.playMode === 'team' ? TEAMS[seatIndex] : '청팀',
      joinedAt: serverTimestamp(),
      lastSeen: serverTimestamp(),
    }, { merge: true });
    transaction.set(seatRefs[seatIndex], { playerId: params.userId, updatedAt: serverTimestamp() });
    transaction.set(roomRef, { emptySince: null, currentPlayers: currentPlayers + 1 }, { merge: true });
    return { role: 'player', seatIndex };
  });
}

export function subscribeRoomPlayers(roomId: string, callback: (players: RoomPlayer[]) => void): Unsubscribe {
  if (!db) { callback([]); return () => undefined; }
  return onSnapshot(query(collection(db, 'rooms', roomId, 'players'), orderBy('seatIndex', 'asc')), (snapshot) => callback(snapshot.docs.map((playerDoc) => ({ id: playerDoc.id, ...(playerDoc.data() as Omit<RoomPlayer, 'id'>) }))));
}


export async function heartbeatRoomPlayer(roomId: string, playerId: string) {
  if (!db || !roomId || !playerId) return;
  const playerRef = doc(db, 'rooms', roomId, 'players', playerId);
  const playerSnapshot = await getDoc(playerRef);
  if (!playerSnapshot.exists()) return;
  await updateDoc(playerRef, { lastSeen: serverTimestamp() });
}

export async function cleanupStaleRooms(staleMs = STALE_PLAYER_DELETE_MS, protectedRoomId = '') {
  if (!db) return;
  const now = Date.now();
  const activeRoomsSnapshot = await getDocs(query(collection(db, 'rooms'), where('status', 'in', ['waiting', 'playing'])));
  await Promise.all(activeRoomsSnapshot.docs.map(async (roomDoc) => {
    if (roomDoc.id === protectedRoomId) return;
    const room = roomDoc.data() as Omit<RoomSummary, 'id'>;
    const playersRef = collection(db!, 'rooms', roomDoc.id, 'players');
    const playersSnapshot = await getDocs(playersRef);
    const stalePlayers = playersSnapshot.docs.filter((playerDoc) => {
      const player = playerDoc.data() as RoomPlayer;
      if (playerDoc.id === room.hostId || player.isAI) return false;
      const lastSeen = getTimestampMillis(player.lastSeen ?? player.joinedAt);
      return !lastSeen || now - lastSeen > staleMs;
    });
    await Promise.all(stalePlayers.map(async (playerDoc) => {
      const player = playerDoc.data() as RoomPlayer;
      await deleteDoc(playerDoc.ref);
      if (!player.isSpectator && Number.isFinite(Number(player.seatIndex))) await deleteDoc(doc(db!, 'rooms', roomDoc.id, 'seats', String(player.seatIndex)));
    }));
    if (stalePlayers.length) await syncRoomPlayerCount(roomDoc.id);
    if (room.status === 'playing') return;
    const remainingHumans = playersSnapshot.docs.filter((playerDoc) => {
      if (stalePlayers.some((staleDoc) => staleDoc.id === playerDoc.id)) return false;
      const player = playerDoc.data() as RoomPlayer;
      return !player.isAI;
    });
    if (!remainingHumans.length) await deleteRoom(roomDoc.id);
  }));
}

async function deleteDocumentRefs(refs: DocumentReference[]) {
  if (!db || refs.length === 0) return;
  for (let index = 0; index < refs.length; index += DELETE_BATCH_SIZE) {
    const batch = writeBatch(db);
    refs.slice(index, index + DELETE_BATCH_SIZE).forEach((ref) => batch.delete(ref));
    await batch.commit();
  }
}

async function deleteRoomSubcollections(roomId: string) {
  if (!db || !roomId) return;
  for (const subcollectionName of ROOM_SUBCOLLECTIONS) {
    const snapshot = await getDocs(collection(db, 'rooms', roomId, subcollectionName));
    await deleteDocumentRefs(snapshot.docs.map((snapshotDoc) => snapshotDoc.ref));
  }
}

const makeSequenceDocId = (sequence: number) => String(sequence).padStart(SEQUENCE_ID_PAD_LENGTH, '0');

const hashFirestoreId = (value: string) => {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= BigInt(value.charCodeAt(index));
    hash = (hash * prime) & mask;
  }
  return hash.toString(16).padStart(16, '0');
};

const makeFirestoreSafeId = (value: string) => {
  const trimmedValue = value.trim();
  if (!trimmedValue) return `action_${Date.now()}`;
  const readablePrefix = trimmedValue.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 80);
  return `${readablePrefix || 'action'}_${hashFirestoreId(trimmedValue)}`;
};
const getClientMutationDocRef = (roomId: string, clientMutationId: string) => doc(db!, 'rooms', roomId, 'processedActions', makeFirestoreSafeId(clientMutationId));

const isTurnOrderIntroActive = (intro: unknown, now = Date.now()) => {
  if (!intro || typeof intro !== 'object' || !('readyAt' in intro)) return false;
  return Number((intro as { readyAt?: unknown }).readyAt ?? 0) > now;
};

export async function saveGameState(roomId: string, state: Omit<SyncedGameState, 'updatedAt' | 'turnVersion'>, meta: GameSequenceMeta = {}) {
  if (!db || !roomId) return null;
  const gameStateRef = doc(db, 'rooms', roomId, 'state', 'current');
  return runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(gameStateRef);
    const currentState = snapshot.exists() ? snapshot.data() as SyncedGameState : null;
    const currentVersion = Number(currentState?.turnVersion ?? 0);
    const currentSequence = Number(currentState?.lastSequence ?? 0);
    const processedActionRef = meta.clientMutationId ? getClientMutationDocRef(roomId, meta.clientMutationId) : null;
    if (processedActionRef) {
      const processedActionSnapshot = await transaction.get(processedActionRef);
      if (processedActionSnapshot.exists()) return Number(processedActionSnapshot.data().turnVersion ?? currentVersion);
    }
    if (meta.clientMutationId && currentState?.lastClientMutationId === meta.clientMutationId) return currentVersion;
    if (typeof meta.expectedPreviousSequence === 'number' && currentSequence !== meta.expectedPreviousSequence) return null;
    const nextVersion = currentVersion + 1;
    const nextSequence = currentSequence + 1;
    const sequenceRef = doc(db!, 'rooms', roomId, 'sequences', makeSequenceDocId(nextSequence));
    transaction.set(sequenceRef, {
      sequence: nextSequence,
      type: meta.type ?? 'state_snapshot',
      actorId: meta.actorId ?? 'system',
      payload: meta.payload ?? {},
      expectedPreviousSequence: meta.expectedPreviousSequence ?? currentSequence,
      ...(meta.clientMutationId ? { clientMutationId: meta.clientMutationId } : {}),
      clientCreatedAt: meta.clientCreatedAt ?? Date.now(),
      createdAt: serverTimestamp(),
    });
    transaction.set(gameStateRef, { ...state, updatedAt: serverTimestamp(), turnVersion: nextVersion, lastSequence: nextSequence, ...(meta.clientMutationId ? { lastClientMutationId: meta.clientMutationId } : {}) }, { merge: true });
    if (processedActionRef) transaction.set(processedActionRef, {
      clientMutationId: meta.clientMutationId,
      sequence: nextSequence,
      turnVersion: nextVersion,
      type: meta.type ?? 'state_snapshot',
      actorId: meta.actorId ?? 'system',
      createdAt: serverTimestamp(),
    });
    return nextVersion;
  });
}

export async function updateTurnOrderState(roomId: string, patcher: (state: SyncedGameState | null) => GameStatePatch | null) {
  if (!db || !roomId) return null;
  const gameStateRef = doc(db, 'rooms', roomId, 'state', 'current');
  return runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(gameStateRef);
    const currentState = snapshot.exists() ? snapshot.data() as SyncedGameState : null;
    const patch = patcher(currentState);
    if (!patch) return null;
    const currentVersion = Number(currentState?.turnVersion ?? 0);
    const nextVersion = currentVersion + 1;
    transaction.set(gameStateRef, { ...patch, updatedAt: serverTimestamp(), turnVersion: nextVersion }, { merge: true });
    return nextVersion;
  });
}

export async function completeTurnOrderIntro(roomId: string, params: { readyAt: number; actorId: string }) {
  if (!db || !roomId || !params.readyAt) return null;
  const clientMutationId = `turn_order_intro_completed:${roomId}:${params.readyAt}`;
  const processedActionRef = getClientMutationDocRef(roomId, clientMutationId);
  const gameStateRef = doc(db, 'rooms', roomId, 'state', 'current');
  return runTransaction(db, async (transaction) => {
    const processedActionSnapshot = await transaction.get(processedActionRef);
    if (processedActionSnapshot.exists()) return Number(processedActionSnapshot.data().turnVersion ?? 0);
    const snapshot = await transaction.get(gameStateRef);
    if (!snapshot.exists()) return null;
    const currentState = snapshot.data() as SyncedGameState;
    const currentIntro = currentState.turnOrderIntro as { readyAt?: unknown } | null | undefined;
    if (!currentIntro || Number(currentIntro.readyAt ?? 0) !== params.readyAt) return Number(currentState.turnVersion ?? 0);
    const currentVersion = Number(currentState.turnVersion ?? 0);
    const currentSequence = Number(currentState.lastSequence ?? 0);
    const nextVersion = currentVersion + 1;
    const nextSequence = currentSequence + 1;
    const sequenceRef = doc(db!, 'rooms', roomId, 'sequences', makeSequenceDocId(nextSequence));
    transaction.set(sequenceRef, {
      sequence: nextSequence,
      type: 'turn_order_intro_completed',
      actorId: params.actorId,
      payload: { readyAt: params.readyAt },
      expectedPreviousSequence: currentSequence,
      clientMutationId,
      clientCreatedAt: Date.now(),
      createdAt: serverTimestamp(),
    });
    transaction.set(gameStateRef, {
      turnOrderIntro: null,
      gameStartedAt: Number(currentState.gameStartedAt ?? 0) || Date.now(),
      updatedAt: serverTimestamp(),
      turnVersion: nextVersion,
      lastSequence: nextSequence,
      lastClientMutationId: clientMutationId,
    }, { merge: true });
    transaction.set(processedActionRef, {
      clientMutationId,
      sequence: nextSequence,
      turnVersion: nextVersion,
      type: 'turn_order_intro_completed',
      actorId: params.actorId,
      createdAt: serverTimestamp(),
    });
    return nextVersion;
  });
}

export function subscribeGameState(roomId: string, callback: (state: SyncedGameState | null) => void): Unsubscribe {
  if (!db) { callback(null); return () => undefined; }
  return onSnapshot(doc(db, 'rooms', roomId, 'state', 'current'), (snapshot) => callback(snapshot.exists() ? snapshot.data() as SyncedGameState : null));
}

export function subscribeGameSequences(roomId: string, afterSequence: number, callback: (sequences: GameSequence[]) => void): Unsubscribe {
  if (!db) { callback([]); return () => undefined; }
  return onSnapshot(query(collection(db, 'rooms', roomId, 'sequences'), where('sequence', '>', afterSequence), orderBy('sequence', 'asc')), (snapshot) => {
    callback(snapshot.docs.map((sequenceDoc) => ({ id: sequenceDoc.id, ...(sequenceDoc.data() as Omit<GameSequence, 'id'>) })));
  }, () => callback([]));
}

export async function getGameSequencesSince(roomId: string, afterSequence: number): Promise<GameSequence[]> {
  if (!db || !roomId) return [];
  const snapshot = await getDocs(query(collection(db, 'rooms', roomId, 'sequences'), where('sequence', '>', afterSequence), orderBy('sequence', 'asc')));
  return snapshot.docs.map((sequenceDoc) => ({ id: sequenceDoc.id, ...(sequenceDoc.data() as Omit<GameSequence, 'id'>) }));
}

export function subscribeActiveRooms(callback: (rooms: RoomSummary[]) => void): Unsubscribe {
  if (!db) { callback([]); return () => undefined; }
  const roomsQuery = query(collection(db, 'rooms'), where('status', 'in', ['waiting', 'playing']));
  return onSnapshot(roomsQuery, (snapshot) => {
    const now = Date.now();
    const rooms = snapshot.docs
      .map((roomDoc) => ({ id: roomDoc.id, ref: roomDoc.ref, ...(roomDoc.data() as Omit<RoomSummary, 'id'>) }))
      .filter((room) => {
        const createdAt = getCreatedAtMillis(room.createdAt);
        const expired = Boolean(createdAt && now - createdAt > ROOM_MAX_AGE_MS);
        if (expired) void deleteDoc(room.ref);
        return !expired;
      })
      .map(({ ref: _ref, ...room }) => room)
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

export async function findActiveRoomByHost(hostId: string): Promise<RoomSummary | null> {
  if (!db || !hostId) return null;
  const snapshot = await getDocs(query(collection(db, 'rooms'), where('hostId', '==', hostId), where('status', 'in', ['waiting', 'playing'])));
  const rooms = snapshot.docs
    .map((roomDoc) => ({ id: roomDoc.id, ...(roomDoc.data() as Omit<RoomSummary, 'id'>) }))
    .sort((a, b) => getCreatedAtMillis(b.createdAt) - getCreatedAtMillis(a.createdAt));
  return rooms[0] ?? null;
}

export async function submitGameAction(roomId: string, action: Omit<GameAction, 'id' | 'createdAt' | 'processed'>) {
  if (!db || !roomId) return;
  const clientActionId = typeof action.payload?.clientActionId === 'string' ? action.payload.clientActionId : '';
  const actionPayload = { ...action, processed: false, createdAt: serverTimestamp() };
  if (clientActionId) {
    await setDoc(doc(db, 'rooms', roomId, 'actions', makeFirestoreSafeId(clientActionId)), actionPayload, { merge: true });
    return;
  }
  await addDoc(collection(db, 'rooms', roomId, 'actions'), actionPayload);
}

type AuthoritativeActionResult = { status: 'committed' | 'duplicate' | 'rejected' | 'unsupported'; sequence?: number; turnVersion?: number; reason?: string; patch?: GameStatePatch; payload?: Record<string, unknown> };
type AuthoritativeCommitReduction = { status: 'committed'; patch: GameStatePatch; payload: Record<string, unknown> };
type AuthoritativeReduction = AuthoritativeCommitReduction | Exclude<AuthoritativeActionResult, { status: 'committed' }>;
const isAuthoritativeCommitReduction = (reduction: AuthoritativeReduction): reduction is AuthoritativeCommitReduction => 'patch' in reduction;
type AuthoritativePiece = { id: string; ownerId: string; label?: string; nodeIndex: number; nodeId: string; started: boolean; finished: boolean; color?: string };
type AuthoritativeLog = { id: number; text: string };
type AuthoritativeTrapNode = { nodeId: string; ownerId: string };
type AuthoritativeSeatSide = { id: string; team: RoomPlayer['team'] };

const getNextLogId = (logs: unknown[]) => logs.reduce<number>((maxId, log) => {
  if (log && typeof log === 'object' && 'id' in log) return Math.max(maxId, Number((log as { id?: unknown }).id) || 0);
  return maxId;
}, 0) + 1;
const makeAuthoritativeLog = (logs: unknown[], text: string): AuthoritativeLog => ({ id: getNextLogId(logs), text });
const getAuthoritativeRoll = (payload: Record<string, unknown> | undefined) => {
  const forcedResult = payload?.forcedResult as YutResult | null | undefined;
  return forcedResult ?? rollYutResult().result;
};
const makeActionReject = (reason: string): AuthoritativeActionResult => ({ status: 'rejected', reason });
const getActionActorLogName = (action: Omit<GameAction, 'id' | 'createdAt' | 'processed'>) => {
  const actorLogName = action.payload?.actorLogName;
  const actorLabel = action.payload?.actorLabel;
  const actorName = action.payload?.actorName;
  if (typeof actorLogName === 'string' && actorLogName.trim()) return actorLogName.trim();
  if (typeof actorLabel === 'string' && typeof actorName === 'string' && actorLabel.trim() && actorName.trim()) return `${actorLabel.trim()}-${actorName.trim()}`;
  if (typeof actorName === 'string' && actorName.trim()) return actorName.trim();
  if (typeof actorLabel === 'string' && actorLabel.trim()) return actorLabel.trim();
  return action.actorId;
};

function makeEngineState(state: SyncedGameState): EngineState {
  return {
    pieces: state.pieces as AuthoritativePiece[],
    turnIndex: Number(state.turnIndex ?? 0),
    turnOrderIds: state.turnOrderIds ?? [],
    roll: (state.roll as YutResult | null | undefined) ?? null,
    logs: (state.logs as AuthoritativeLog[] | undefined) ?? [],
    winner: state.winner ?? '',
    turnOrderPhase: state.turnOrderPhase as { active?: boolean } | null | undefined,
    turnOrderIntro: state.turnOrderIntro as { readyAt?: unknown } | null | undefined,
    pendingTrapPlacement: state.pendingTrapPlacement,
    trapNodes: (state.trapNodes as AuthoritativeTrapNode[] | undefined) ?? [],
    shieldedPieceIds: state.shieldedPieceIds ?? [],
    branchChoice: (state.branchChoice as BranchChoice | undefined) ?? 'outer',
  };
}

function toAuthoritativeReduction(reduction: ReturnType<typeof reduceRollCommand> | ReturnType<typeof reduceMoveCommand>): AuthoritativeReduction {
  if (!reduction.ok) return makeActionReject(reduction.message);
  return { status: 'committed' as const, patch: reduction.patch as GameStatePatch, payload: reduction.payload };
}

function reduceAuthoritativeRoll(state: SyncedGameState, action: Omit<GameAction, 'id' | 'createdAt' | 'processed'>): AuthoritativeReduction {
  const nextRoll = getAuthoritativeRoll(action.payload);
  return toAuthoritativeReduction(reduceRollCommand({
    state: makeEngineState(state),
    actorId: action.actorId,
    nextRoll,
    actorLogName: getActionActorLogName(action),
    rollResultReadyAt: Date.now() + 2600,
    makeLog: makeAuthoritativeLog,
  }));
}
function reduceAuthoritativeMove(state: SyncedGameState, action: Omit<GameAction, 'id' | 'createdAt' | 'processed'>, room: Omit<RoomSummary, 'id'>, sides: AuthoritativeSeatSide[]): AuthoritativeReduction {
  return toAuthoritativeReduction(reduceMoveCommand({
    state: makeEngineState(state),
    actorId: action.actorId,
    pieceId: String(action.payload?.pieceId ?? ''),
    branchChoice: (action.payload?.branchChoice as BranchChoice | undefined) ?? 'outer',
    extraSteps: Number(action.payload?.extraSteps ?? 0),
    actorLogName: getActionActorLogName(action),
    playMode: room.playMode,
    sides,
    makeLog: makeAuthoritativeLog,
  }));
}
export async function commitAuthoritativeGameAction(roomId: string, action: Omit<GameAction, 'id' | 'createdAt' | 'processed'>): Promise<AuthoritativeActionResult> {
  if (!db || !roomId) return { status: 'rejected', reason: 'Firebase 환경변수가 설정되지 않았습니다.' };
  const clientActionId = typeof action.payload?.clientActionId === 'string' ? action.payload.clientActionId : `${action.type}:${action.actorId}:${Date.now()}`;
  const processedActionRef = getClientMutationDocRef(roomId, clientActionId);
  const gameStateRef = doc(db, 'rooms', roomId, 'state', 'current');
  const roomRef = doc(db, 'rooms', roomId);

  return runTransaction(db, async (transaction): Promise<AuthoritativeActionResult> => {
    const processedActionSnapshot = await transaction.get(processedActionRef);
    if (processedActionSnapshot.exists()) return { status: 'duplicate', sequence: Number(processedActionSnapshot.data().sequence ?? 0), turnVersion: Number(processedActionSnapshot.data().turnVersion ?? 0) };
    const stateSnapshot = await transaction.get(gameStateRef);
    if (!stateSnapshot.exists()) return { status: 'rejected', reason: '아직 게임 상태가 준비되지 않았습니다.' };
    const roomSnapshot = await transaction.get(roomRef);
    if (!roomSnapshot.exists()) return { status: 'rejected', reason: '존재하지 않는 방입니다.' };
    const state = stateSnapshot.data() as SyncedGameState;
    const room = roomSnapshot.data() as Omit<RoomSummary, 'id'>;
    const currentVersion = Number(state.turnVersion ?? 0);
    const currentSequence = Number(state.lastSequence ?? 0);
    let reduction: AuthoritativeReduction;
    if (action.type === 'roll_yut') reduction = reduceAuthoritativeRoll(state, action);
    else if (action.type === 'move_piece') {
      const turnOrderIds = state.turnOrderIds ?? [];
      const transactionSides = await Promise.all(turnOrderIds.map(async (playerId) => {
        const playerSnapshot = await transaction.get(doc(db!, 'rooms', roomId, 'players', playerId));
        if (!playerSnapshot.exists()) return null;
        const player = playerSnapshot.data() as RoomPlayer;
        return { id: playerId, team: player.team } satisfies AuthoritativeSeatSide;
      }));
      reduction = reduceAuthoritativeMove(state, action, room, transactionSides.filter((entry): entry is AuthoritativeSeatSide => Boolean(entry)));
    } else return { status: 'unsupported', reason: '아직 transaction 처리로 이전되지 않은 액션입니다.' };
    if (!isAuthoritativeCommitReduction(reduction)) return reduction;
    const nextVersion = currentVersion + 1;
    const nextSequence = currentSequence + 1;
    const sequenceRef = doc(db!, 'rooms', roomId, 'sequences', makeSequenceDocId(nextSequence));
    transaction.set(sequenceRef, {
      sequence: nextSequence,
      type: action.type === 'roll_yut' ? 'roll_yut' : 'move_piece_resolved',
      actorId: action.actorId,
      payload: reduction.payload,
      expectedPreviousSequence: currentSequence,
      clientMutationId: clientActionId,
      clientCreatedAt: Date.now(),
      createdAt: serverTimestamp(),
    });
    transaction.set(gameStateRef, { ...reduction.patch, updatedAt: serverTimestamp(), turnVersion: nextVersion, lastSequence: nextSequence, lastClientMutationId: clientActionId }, { merge: true });
    transaction.set(processedActionRef, { clientMutationId: clientActionId, sequence: nextSequence, turnVersion: nextVersion, type: action.type, actorId: action.actorId, createdAt: serverTimestamp() });
    return { status: 'committed', sequence: nextSequence, turnVersion: nextVersion, patch: reduction.patch, payload: reduction.payload };
  });
}

export function subscribePendingGameActions(roomId: string, callback: (actions: GameAction[]) => void): Unsubscribe {
  if (!db) { callback([]); return () => undefined; }
  return onSnapshot(query(collection(db, 'rooms', roomId, 'actions'), where('processed', '==', false), orderBy('createdAt', 'asc')), (snapshot) => {
    callback(snapshot.docs.map((actionDoc) => ({ id: actionDoc.id, ...(actionDoc.data() as Omit<GameAction, 'id'>) })));
  }, () => callback([]));
}

export async function markGameActionProcessed(roomId: string, actionId: string) {
  if (!db || !roomId || !actionId) return;
  await deleteDoc(doc(db, 'rooms', roomId, 'actions', actionId));
}

export async function getRoom(roomId: string): Promise<RoomSummary | null> {
  if (!db) return null;
  const roomSnapshot = await getDoc(doc(db, 'rooms', roomId));
  return roomSnapshot.exists() ? { id: roomSnapshot.id, ...(roomSnapshot.data() as Omit<RoomSummary, 'id'>) } : null;
}

export async function updateRoomOptions(roomId: string, params: Partial<Pick<RoomSummary, 'itemMode' | 'pieceCount' | 'playMode' | 'maxPlayers'>>) {
  if (!db) throw new Error('Firebase 환경변수가 설정되지 않았습니다.');
  await updateDoc(doc(db, 'rooms', roomId), params);
}

export async function updateRoomPlayer(roomId: string, playerId: string, params: Partial<Omit<RoomPlayer, 'id'>>) {
  if (!db) throw new Error('Firebase 환경변수가 설정되지 않았습니다.');
  await setDoc(doc(db, 'rooms', roomId, 'players', playerId), params, { merge: true });
  if (typeof params.seatIndex === 'number' && !params.isSpectator) await setDoc(doc(db, 'rooms', roomId, 'seats', String(params.seatIndex)), { playerId, updatedAt: serverTimestamp() }, { merge: true });
  await syncRoomPlayerCount(roomId);
}

async function deleteRoomIfStillEmpty(roomId: string, expectedEmptySince: number) {
  if (!db) return;
  const roomRef = doc(db, 'rooms', roomId);
  const roomSnapshot = await getDoc(roomRef);
  if (!roomSnapshot.exists()) return;
  const playersSnapshot = await getDocs(query(collection(db, 'rooms', roomId, 'players'), limit(1)));
  const room = roomSnapshot.data() as Omit<RoomSummary, 'id'>;
  if (playersSnapshot.empty && Number(room.emptySince ?? 0) === expectedEmptySince) await deleteRoom(roomId);
}

export async function scheduleEmptyRoomDeletion(roomId: string) {
  if (!db) return;
  const playersSnapshot = await getDocs(query(collection(db, 'rooms', roomId, 'players'), limit(1)));
  const roomRef = doc(db, 'rooms', roomId);
  if (!playersSnapshot.empty) {
    await syncRoomPlayerCount(roomId);
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
  const playerRef = doc(db, 'rooms', roomId, 'players', playerId);
  const playerSnapshot = await getDoc(playerRef);
  const player = playerSnapshot.exists() ? playerSnapshot.data() as RoomPlayer : null;
  await deleteDoc(playerRef);
  if (player && !player.isSpectator && Number.isFinite(Number(player.seatIndex))) await deleteDoc(doc(db, 'rooms', roomId, 'seats', String(player.seatIndex)));
  await syncRoomPlayerCount(roomId);
  const remainingPlayersSnapshot = await getDocs(query(collection(db, 'rooms', roomId, 'players'), orderBy('seatIndex', 'asc'), limit(1)));
  if (remainingPlayersSnapshot.empty) {
    await deleteRoom(roomId);
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
  await deleteRoomSubcollections(roomId);
  await deleteDoc(doc(db, 'rooms', roomId));
}
