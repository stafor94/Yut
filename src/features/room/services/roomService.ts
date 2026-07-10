import { addDoc, collection, deleteDoc, doc, getDoc, getDocs, limit, onSnapshot, orderBy, query, runTransaction, serverTimestamp, setDoc, updateDoc, where, writeBatch, type DocumentReference, type Unsubscribe } from 'firebase/firestore';
import { db } from '../../../services/firebase/firebaseDb';
import { auth } from '../../../services/firebase/firebaseAuth';
import { isAuthoritativeCommitReduction, reduceAuthoritativeGameAction, type AuthoritativeActionResult, type AuthoritativeReduction, type AuthoritativeSeatSide } from './roomAuthoritativeReducer';
import { DELETE_BATCH_SIZE, ROOM_SUBCOLLECTIONS, getClientMutationDocRef, makeFirestoreSafeId, makeSequenceDocId, sanitizeForFirestore } from './roomFirestore';
import { spawnInitialBoardItems, type BoardItem } from '../../../game-core/board/board';
import { type YutResult } from '../../../game-core/roll';

export interface RoomSummary {
  id: string; title: string; hostId?: string; status: 'waiting' | 'playing' | 'finished'; maxPlayers: number; itemMode: boolean; stackedRollMode?: boolean; playMode: 'individual' | 'team'; pieceCount: 1 | 2 | 3 | 4; createdAt?: unknown; emptySince?: number | null; currentPlayers?: number; playerIds?: string[]; startCountdownUntil?: number; startRequestVersion?: number; startRequestedAt?: number; startCountdownStartsAt?: number; startCountdownEndsAt?: number; startCancelledAt?: number | null; startStatus?: 'idle' | 'requested' | 'cancelled' | 'entering' | 'playing'; roomConfigVersion?: number;
}

const getCreatedAtMillis = (createdAt: unknown) => {
  if (createdAt && typeof createdAt === 'object' && 'toMillis' in createdAt && typeof createdAt.toMillis === 'function') {
    return createdAt.toMillis();
  }
  if (createdAt instanceof Date) return createdAt.getTime();
  if (typeof createdAt === 'number') return createdAt;
  return 0;
};
export interface RoomPlayer { id: string; nickname: string; ready: boolean; color: string; seatIndex: number; team: '청팀' | '홍팀'; isAI?: boolean; isSubstitutedByAI?: boolean; isSpectator?: boolean; joinedAt?: unknown; lastSeen?: unknown; enteredGameAt?: number; enteredStartVersion?: number; lastGamePresenceAt?: number; playerId?: string; currentPlayerId?: string; originalPlayerId?: string; }
export interface RoomSeat { id: string; playerId: string; originalPlayerId?: string; currentPlayerId?: string; nickname?: string; color?: string; team?: RoomPlayer['team']; seatIndex?: number; label?: string; isHost?: boolean; aiActive?: boolean; aiName?: string; isSubstitutedByAI?: boolean; status?: 'human' | 'ai_substitute' | 'disconnected' | 'removed'; updatedAt?: unknown; createdAt?: unknown; }
export type GameSeatSnapshot = { id: string; label: string; name: string; color: string; team: RoomPlayer['team']; isHost?: boolean; isAI?: boolean; isSubstitutedByAI?: boolean; seatIndex: number };
export interface SyncedGameState { pieces: unknown[]; turnIndex: number; turnOrderIds?: string[]; initialTurnOrderIds?: string[]; completedSeatIds?: string[]; rankingSeatIds?: string[]; gameEndMode?: 'partial_finish' | 'final' | ''; lastFinishedSeatId?: string; continuationRound?: number; roll: unknown | null; rollStack?: unknown[]; selectedRollStackIndex?: number | null; rollStackClosed?: boolean; rollAnimation?: unknown | null; boardItems: BoardItem[]; ownedItems: Record<string, unknown[]>; trapNodes: unknown[]; shieldedPieceIds: string[]; logs: unknown[]; winner: string; captureEffect?: unknown | null; trapEffect?: unknown | null; fallEffect?: unknown | null; lastRollTimingZone?: unknown | null; pendingGoldenYutSelection?: unknown | null; gameStartedAt?: number | null; turnOrderIntro?: unknown | null; pendingTrapPlacement?: unknown | null; pendingItemPickup?: unknown | null; rollLockUntil?: number; lastMovedPieceIds?: string[]; lastMovedSeatId?: string; itemPromptTiming?: unknown | null; pendingAfterMoveTurnIndex?: number; branchChoice?: unknown; rollResultReadyAt?: number; turnOrderPhase?: unknown | null; waitingForPlayersReady?: boolean; turnDeadlineAt?: number; turnDeadlineKind?: 'roll' | 'move' | 'turn_order' | 'item_prompt' | 'trap_placement' | ''; startRequestVersion?: number; gameSeats?: GameSeatSnapshot[]; updatedAt?: unknown; turnVersion: number; lastSequence?: number; lastClientMutationId?: string; }
export type GameStatePatch = Partial<Omit<SyncedGameState, 'updatedAt' | 'turnVersion'>>;
export interface GameAction { id: string; type: 'turn_order_roll' | 'roll_yut' | 'move_piece' | 'continue_race' | 'use_item' | 'place_trap' | 'item_pickup_decision'; actorId: string; payload?: Record<string, unknown>; createdAt?: unknown; processed?: boolean; }
export type GameSequenceType = 'state_snapshot' | 'game_initialized' | 'turn_order_roll' | 'turn_order_resolved' | 'turn_order_intro_completed' | 'roll_yut' | 'move_piece_resolved' | 'race_continued' | 'item_used' | 'trap_placed' | 'item_pickup_decided' | 'game_finished';
export interface GameSequence { id: string; sequence: number; type: GameSequenceType; actorId: string; payload?: Record<string, unknown>; eventSchemaVersion?: number; action?: Omit<GameAction, 'id' | 'createdAt' | 'processed'> | null; patch?: GameStatePatch | null; stateBefore?: SyncedGameState | null; stateAfter?: Omit<SyncedGameState, 'updatedAt'>; expectedPreviousSequence?: number; clientMutationId?: string; createdAt?: unknown; clientCreatedAt?: number; }
export type GameSequenceMeta = { type?: GameSequenceType; actorId?: string; payload?: Record<string, unknown>; action?: Omit<GameAction, 'id' | 'createdAt' | 'processed'> | null; clientMutationId?: string; clientCreatedAt?: number; expectedPreviousSequence?: number };
export type CommitAuthoritativeGameActionResult = AuthoritativeActionResult & {
  stateAfter?: Omit<SyncedGameState, 'updatedAt'>;
  sequenceEvent?: GameSequence;
};

const COLORS = ['red', 'blue', 'green', 'yellow'];
const TEAMS: RoomPlayer['team'][] = ['청팀', '홍팀', '청팀', '홍팀'];
const MAX_ACTIVE_ROOMS = 3;
const QA_ROOM_TITLE_PREFIX = 'QA-';
const EMPTY_ROOM_DELETE_DELAY_MS = 30000;
const STALE_PLAYER_DELETE_MS = 45000;
const ROOM_MAX_AGE_MS = 2 * 60 * 60 * 1000;


const canAuthenticatedUserActForPlayer = (playerId: string, player: RoomPlayer | null, room: Pick<RoomSummary, 'hostId'>, options: { coordinatorPlayerIds?: string[]; allowCoordinator?: boolean } = {}) => {
  if (!auth) return true;
  const uid = auth.currentUser?.uid;
  if (!uid) return false;
  if (options.allowCoordinator && (options.coordinatorPlayerIds ?? []).includes(uid)) return true;
  if (player?.isAI || player?.isSubstitutedByAI) {
    return uid === room.hostId || (options.coordinatorPlayerIds ?? []).includes(uid);
  }
  return [playerId, player?.playerId, player?.currentPlayerId, player?.originalPlayerId]
    .some((candidate) => typeof candidate === 'string' && candidate === uid);
};

const isExpiredItemPromptTimeoutRecoveryAction = (state: SyncedGameState, action: Omit<GameAction, 'id' | 'createdAt' | 'processed'>) => (
  action.type === 'use_item'
  && action.payload?.itemPromptTimeoutRecovery === true
  && state.turnDeadlineKind === 'item_prompt'
  && typeof state.turnDeadlineAt === 'number'
  && Date.now() >= state.turnDeadlineAt
);

const isExpiredTrapPlacementTimeoutRecoveryAction = (state: SyncedGameState, action: Omit<GameAction, 'id' | 'createdAt' | 'processed'>) => {
  const placement = state.pendingTrapPlacement as { ownerId?: unknown; pieceId?: unknown; deadline?: unknown } | null | undefined;
  return action.type === 'use_item'
    && action.payload?.cancelTrapPlacement === true
    && action.payload?.trapPlacementTimeoutRecovery === true
    && state.turnDeadlineKind === 'trap_placement'
    && placement?.ownerId === action.actorId
    && typeof placement.pieceId === 'string'
    && action.payload?.pieceId === placement.pieceId
    && typeof placement.deadline === 'number'
    && action.payload?.placementDeadline === placement.deadline
    && Date.now() >= placement.deadline;
};

const isQaRoomTitle = (title: unknown) => typeof title === 'string' && title.startsWith(QA_ROOM_TITLE_PREFIX);

const isInactiveRoom = (room: Partial<RoomSummary>, now = Date.now()) => {
  const createdAt = getCreatedAtMillis(room.createdAt);
  const missingCreatedAt = !createdAt;
  const expired = Boolean(createdAt && now - createdAt > ROOM_MAX_AGE_MS);
  const emptyGhost = room.currentPlayers !== undefined && Number(room.currentPlayers) <= 0;
  return room.status === 'finished' || missingCreatedAt || expired || emptyGhost;
};

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
    await removeRoomPlayer(room.id, playerId);
  }));
  return roomsToLeave.map(({ room }) => room.id);
}

export async function createRoom(params: { title: string; hostId: string; nickname: string; maxPlayers: 2|3|4; itemMode: boolean; stackedRollMode?: boolean; playMode: 'individual'|'team'; pieceCount: 1|2|3|4; password?: string; }) {
  if (!db) throw new Error('Firebase 환경변수가 설정되지 않았습니다.');
  const firestore = db;
  const normalizedTitle = params.title.trim();
  if (!normalizedTitle) throw new Error('방 제목을 입력해주세요.');
  const roomsRef = collection(firestore, 'rooms');
  const now = Date.now();
  await cleanupInactiveRooms();
  const existingHostRooms = await getDocs(query(roomsRef, where('hostId', '==', params.hostId)));
  const activeHostRoom = existingHostRooms.docs.find((roomDoc) => {
    const room = roomDoc.data() as Partial<RoomSummary>;
    return isRoomInGame(room as Pick<RoomSummary, 'status'> & Partial<Pick<RoomSummary, 'startStatus'>>) && !isInactiveRoom(room, now);
  });
  if (activeHostRoom) throw new Error('이미 진행 중인 방이 있습니다. 기존 방으로 돌아간 뒤 새 방을 만들어주세요.');
  const staleHostRoomRefs = existingHostRooms.docs
    .filter((roomDoc) => {
      const room = roomDoc.data() as Partial<RoomSummary>;
      return room.status === 'finished' || (room.status === 'waiting' && isInactiveRoom(room, now));
    })
    .map((roomDoc) => roomDoc.ref);
  if (staleHostRoomRefs.length) {
    await Promise.all(staleHostRoomRefs.map((roomRef) => deleteRoom(roomRef.id)));
  }

  const activeRoomsSnapshot = await getDocs(query(roomsRef, where('status', 'in', ['waiting', 'playing'])));
  const activeRoomDocs = activeRoomsSnapshot.docs.filter((roomDoc) => {
    const room = roomDoc.data() as Omit<RoomSummary, 'id'>;
    const inactive = isInactiveRoom(room, now);
    if (inactive) void deleteRoom(roomDoc.id).catch((error) => console.warn('비활성 방 정리에 실패했습니다.', error));
    return !inactive;
  });
  const activeRooms = activeRoomDocs.map((roomDoc) => roomDoc.data() as Omit<RoomSummary, 'id'>);
  const activeUserRooms = activeRooms.filter((room) => !isQaRoomTitle(room.title));
  if (!isQaRoomTitle(normalizedTitle) && activeUserRooms.length >= MAX_ACTIVE_ROOMS) throw new Error('방은 최대 3개까지만 만들 수 있습니다. 기존 방에 참여하거나 잠시 뒤 다시 시도해주세요.');
  if (activeRooms.some((room) => room.title.trim().toLocaleLowerCase() === normalizedTitle.toLocaleLowerCase())) throw new Error('이미 존재하는 방 제목입니다. 다른 제목을 입력해주세요.');

  const roomRef = doc(roomsRef);
  const createBatch = writeBatch(firestore);
  createBatch.set(roomRef, {
    title: normalizedTitle,
    hostId: params.hostId,
    maxPlayers: params.maxPlayers,
    itemMode: params.itemMode,
    stackedRollMode: Boolean(params.stackedRollMode),
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
  createBatch.set(doc(firestore, 'rooms', roomRef.id, 'seats', '0'), { playerId: params.hostId, originalPlayerId: params.hostId, currentPlayerId: params.hostId, nickname: params.nickname, color: COLORS[0], team: '청팀', seatIndex: 0, label: 'P1', isHost: true, aiActive: false, status: 'human', createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
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

export function isRoomInGame(room: Pick<RoomSummary, 'status'> & Partial<Pick<RoomSummary, 'startStatus'>>) {
  return room.status === 'playing' || room.startStatus === 'entering' || room.startStatus === 'playing';
}

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
    const maxPlayers = room.maxPlayers as 2 | 3 | 4;
    const seatRefs = Array.from({ length: maxPlayers }, (_, index) => doc(db!, 'rooms', roomId, 'seats', String(index)));
    const seatSnapshots = await Promise.all(seatRefs.map((seatRef) => transaction.get(seatRef)));
    const matchingLockedSeatIndex = seatSnapshots.findIndex((seatSnapshot) => {
      if (!seatSnapshot.exists()) return false;
      const seat = seatSnapshot.data() as RoomSeat;
      return String(seat.originalPlayerId ?? seat.playerId ?? '') === params.userId;
    });

    if (existingPlayer.exists()) {
      const existingData = existingPlayer.data() as RoomPlayer;
      const existingSeatIndex = Number(existingData.seatIndex);
      const seatIndexForUser = seatSnapshots.findIndex((seatSnapshot) => seatSnapshot.exists() && String(seatSnapshot.data().playerId ?? '') === params.userId);
      const restoreSeatIndex = matchingLockedSeatIndex >= 0 ? matchingLockedSeatIndex : seatIndexForUser >= 0 ? seatIndexForUser : existingSeatIndex;
      const hasValidActiveSeat = Number.isInteger(restoreSeatIndex) && restoreSeatIndex >= 0 && restoreSeatIndex < maxPlayers && (!existingData.isSpectator || seatIndexForUser >= 0 || matchingLockedSeatIndex >= 0);
      if (hasValidActiveSeat) {
        const restoredTeam = existingData.team ?? (params.playMode === 'team' ? TEAMS[restoreSeatIndex] : '청팀');
        const restoredColor = existingData.color ?? COLORS[restoreSeatIndex] ?? 'black';
        const restoredNickname = existingData.isSubstitutedByAI ? (existingData.nickname || params.nickname) : params.nickname;
        transaction.set(playerRef, { nickname: restoredNickname, ready: true, color: restoredColor, seatIndex: restoreSeatIndex, team: restoredTeam, isAI: false, isSubstitutedByAI: false, isSpectator: false, lastSeen: serverTimestamp() }, { merge: true });
        transaction.set(seatRefs[restoreSeatIndex], { playerId: params.userId, originalPlayerId: params.userId, currentPlayerId: params.userId, nickname: restoredNickname, color: restoredColor, team: restoredTeam, seatIndex: restoreSeatIndex, label: `P${restoreSeatIndex + 1}`, aiActive: false, aiName: '', isSubstitutedByAI: false, status: 'human', updatedAt: serverTimestamp() }, { merge: true });
        transaction.set(roomRef, { emptySince: null }, { merge: true });
        return { role: 'player', seatIndex: restoreSeatIndex };
      }
      const currentPlayers = seatSnapshots.filter((seatSnapshot) => seatSnapshot.exists()).length;

      if (isRoomInGame(room)) {
        if (existingData.isSpectator) {
          transaction.set(playerRef, { nickname: params.nickname, lastSeen: serverTimestamp() }, { merge: true });
          transaction.set(roomRef, { emptySince: null, currentPlayers }, { merge: true });
          return { role: 'spectator', seatIndex: null };
        }
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
      transaction.set(seatRefs[seatIndex], { playerId: params.userId, originalPlayerId: params.userId, currentPlayerId: params.userId, nickname: params.nickname, color: COLORS[seatIndex] ?? 'black', team: params.playMode === 'team' ? TEAMS[seatIndex] : '청팀', seatIndex, label: `P${seatIndex + 1}`, aiActive: false, status: 'human', createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
      transaction.set(roomRef, { emptySince: null, currentPlayers: currentPlayers + 1 }, { merge: true });
      return { role: 'player', seatIndex };
    }

    const currentPlayers = seatSnapshots.filter((seatSnapshot) => seatSnapshot.exists()).length;

    if (matchingLockedSeatIndex >= 0) {
      const lockedSeat = seatSnapshots[matchingLockedSeatIndex].data() as RoomSeat;
      const restoredTeam = lockedSeat.team ?? (params.playMode === 'team' ? TEAMS[matchingLockedSeatIndex] : '청팀');
      const restoredColor = lockedSeat.color ?? COLORS[matchingLockedSeatIndex] ?? 'black';
      const restoredNickname = lockedSeat.isSubstitutedByAI ? (lockedSeat.nickname || params.nickname) : params.nickname;
      transaction.set(playerRef, { nickname: restoredNickname, ready: true, color: restoredColor, seatIndex: matchingLockedSeatIndex, team: restoredTeam, isAI: false, isSubstitutedByAI: false, isSpectator: false, joinedAt: serverTimestamp(), lastSeen: serverTimestamp() }, { merge: true });
      transaction.set(seatRefs[matchingLockedSeatIndex], { playerId: params.userId, originalPlayerId: params.userId, currentPlayerId: params.userId, nickname: restoredNickname, color: restoredColor, team: restoredTeam, seatIndex: matchingLockedSeatIndex, label: `P${matchingLockedSeatIndex + 1}`, aiActive: false, aiName: '', isSubstitutedByAI: false, status: 'human', updatedAt: serverTimestamp() }, { merge: true });
      transaction.set(roomRef, { emptySince: null, currentPlayers }, { merge: true });
      return { role: 'player', seatIndex: matchingLockedSeatIndex };
    }

    if (isRoomInGame(room)) {
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
    transaction.set(seatRefs[seatIndex], { playerId: params.userId, originalPlayerId: params.userId, currentPlayerId: params.userId, nickname: params.nickname, color: COLORS[seatIndex] ?? 'black', team: params.playMode === 'team' ? TEAMS[seatIndex] : '청팀', seatIndex, label: `P${seatIndex + 1}`, aiActive: false, status: 'human', createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
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
      if (isRoomInGame(room) && !player.isSpectator && Number.isFinite(Number(player.seatIndex))) {
        await setDoc(playerDoc.ref, {
          nickname: player.nickname || '플레이어',
          ready: true,
          isAI: true,
          isSubstitutedByAI: true,
          lastSeen: serverTimestamp(),
        }, { merge: true });
        await setDoc(doc(db!, 'rooms', roomDoc.id, 'seats', String(player.seatIndex)), { playerId: playerDoc.id, originalPlayerId: playerDoc.id, currentPlayerId: playerDoc.id, nickname: player.nickname, color: player.color, team: player.team, seatIndex: Number(player.seatIndex), label: `P${Number(player.seatIndex) + 1}`, aiActive: true, aiName: '', isSubstitutedByAI: true, status: 'ai_substitute', updatedAt: serverTimestamp() }, { merge: true });
        return;
      }
      await deleteDoc(playerDoc.ref);
      if (!player.isSpectator && Number.isFinite(Number(player.seatIndex))) await setDoc(doc(db!, 'rooms', roomDoc.id, 'seats', String(player.seatIndex)), { playerId: playerDoc.id, originalPlayerId: playerDoc.id, currentPlayerId: playerDoc.id, nickname: player.nickname, color: player.color, team: player.team, seatIndex: Number(player.seatIndex), label: `P${Number(player.seatIndex) + 1}`, aiActive: false, status: 'disconnected', updatedAt: serverTimestamp() }, { merge: true });
    }));
    if (stalePlayers.length) await syncRoomPlayerCount(roomDoc.id);
    if (isRoomInGame(room)) return;
    const remainingHumans = playersSnapshot.docs.filter((playerDoc) => {
      if (stalePlayers.some((staleDoc) => staleDoc.id === playerDoc.id)) return false;
      const player = playerDoc.data() as RoomPlayer;
      return !player.isAI && !player.isSpectator;
    });
    if (!remainingHumans.length) await deleteRoom(roomDoc.id);
  }));
}

export async function cleanupInactiveRooms(protectedRoomId = '') {
  if (!db) return [];
  const now = Date.now();
  const roomsSnapshot = await getDocs(collection(db, 'rooms'));
  const inactiveRoomDocs = roomsSnapshot.docs.filter((roomDoc) => {
    if (roomDoc.id === protectedRoomId) return false;
    return isInactiveRoom(roomDoc.data() as Partial<RoomSummary>, now);
  });
  await Promise.all(inactiveRoomDocs.map((roomDoc) => deleteRoom(roomDoc.id)));
  return inactiveRoomDocs.map((roomDoc) => roomDoc.id);
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

const makeFirestoreStateData = (state: Omit<SyncedGameState, 'updatedAt' | 'turnVersion'> | GameStatePatch) => sanitizeForFirestore(state) as Record<string, unknown>;

const makeSequenceEventFields = (params: { stateBefore: SyncedGameState | null; stateAfter: Omit<SyncedGameState, 'updatedAt'> | Omit<SyncedGameState, 'updatedAt' | 'turnVersion'>; patch?: GameStatePatch; action?: Omit<GameAction, 'id' | 'createdAt' | 'processed'> }) => sanitizeForFirestore({
  eventSchemaVersion: 1,
  action: params.action ?? null,
  patch: params.patch ?? null,
  stateBefore: params.stateBefore,
  stateAfter: params.stateAfter,
}) as Pick<GameSequence, 'eventSchemaVersion' | 'action' | 'patch' | 'stateBefore' | 'stateAfter'>;

const isTurnOrderIntroActive = (intro: unknown, now = Date.now()) => {
  if (!intro || typeof intro !== 'object' || !('readyAt' in intro)) return false;
  return Number((intro as { readyAt?: unknown }).readyAt ?? 0) > now;
};

export type SaveGameStateResult = { status: 'committed' | 'duplicate' | 'sequence_mismatch' | 'unavailable'; turnVersion?: number; lastSequence?: number };

export async function saveGameState(roomId: string, state: Omit<SyncedGameState, 'updatedAt' | 'turnVersion'>, meta: GameSequenceMeta = {}): Promise<SaveGameStateResult> {
  if (!db || !roomId) return { status: 'unavailable' };
  const gameStateRef = doc(db, 'rooms', roomId, 'state', 'current');
  return runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(gameStateRef);
    const currentState = snapshot.exists() ? snapshot.data() as SyncedGameState : null;
    const currentVersion = Number(currentState?.turnVersion ?? 0);
    const currentSequence = Number(currentState?.lastSequence ?? 0);
    const processedActionRef = meta.clientMutationId ? getClientMutationDocRef(roomId, meta.clientMutationId) : null;
    if (processedActionRef) {
      const processedActionSnapshot = await transaction.get(processedActionRef);
      if (processedActionSnapshot.exists()) return {
        status: 'duplicate' as const,
        turnVersion: Number(processedActionSnapshot.data().turnVersion ?? currentVersion),
        lastSequence: Number(processedActionSnapshot.data().sequence ?? currentSequence),
      };
    }
    if (meta.clientMutationId && currentState?.lastClientMutationId === meta.clientMutationId) return { status: 'duplicate' as const, turnVersion: currentVersion, lastSequence: currentSequence };
    if (typeof meta.expectedPreviousSequence === 'number' && currentSequence !== meta.expectedPreviousSequence) return { status: 'sequence_mismatch' as const, turnVersion: currentVersion, lastSequence: currentSequence };
    const nextVersion = currentVersion + 1;
    const nextSequence = currentSequence + 1;
    const sequenceRef = doc(db!, 'rooms', roomId, 'sequences', makeSequenceDocId(nextSequence));
    transaction.set(sequenceRef, {
      sequence: nextSequence,
      type: meta.type ?? 'state_snapshot',
      actorId: meta.actorId ?? 'system',
      payload: sanitizeForFirestore(meta.payload ?? {}) as Record<string, unknown>,
      ...makeSequenceEventFields({ stateBefore: currentState, stateAfter: state, action: meta.action ?? undefined }),
      expectedPreviousSequence: meta.expectedPreviousSequence ?? currentSequence,
      ...(meta.clientMutationId ? { clientMutationId: meta.clientMutationId } : {}),
      clientCreatedAt: meta.clientCreatedAt ?? Date.now(),
      createdAt: serverTimestamp(),
    });
    transaction.set(gameStateRef, { ...makeFirestoreStateData(state), updatedAt: serverTimestamp(), turnVersion: nextVersion, lastSequence: nextSequence, ...(meta.clientMutationId ? { lastClientMutationId: meta.clientMutationId } : {}) }, { merge: true });
    if (processedActionRef) transaction.set(processedActionRef, {
      clientMutationId: meta.clientMutationId,
      sequence: nextSequence,
      turnVersion: nextVersion,
      type: meta.type ?? 'state_snapshot',
      actorId: meta.actorId ?? 'system',
      createdAt: serverTimestamp(),
    });
    return { status: 'committed' as const, turnVersion: nextVersion, lastSequence: nextSequence };
  });
}

export async function initializeGameState(roomId: string, state: Omit<SyncedGameState, 'updatedAt' | 'turnVersion'>, meta: { actorId: string; startRequestVersion: number; clientMutationId: string; payload?: Record<string, unknown> }): Promise<SaveGameStateResult> {
  if (!db || !roomId) return { status: 'unavailable' };
  const roomRef = doc(db, 'rooms', roomId);
  const gameStateRef = doc(db, 'rooms', roomId, 'state', 'current');
  const processedActionRef = getClientMutationDocRef(roomId, meta.clientMutationId);
  return runTransaction(db, async (transaction) => {
    const processedActionSnapshot = await transaction.get(processedActionRef);
    const currentStateSnapshot = await transaction.get(gameStateRef);
    const roomSnapshot = await transaction.get(roomRef);
    if (!roomSnapshot.exists()) return { status: 'unavailable' as const };
    const room = roomSnapshot.data() as Omit<RoomSummary, 'id'>;
    const currentState = currentStateSnapshot.exists() ? currentStateSnapshot.data() as SyncedGameState : null;
    const currentVersion = Number(currentState?.turnVersion ?? 0);
    const currentSequence = Number(currentState?.lastSequence ?? 0);
    const currentRoomStartVersion = Number(room.startRequestVersion ?? 0);
    if (currentRoomStartVersion !== meta.startRequestVersion) return { status: 'sequence_mismatch' as const, turnVersion: currentVersion, lastSequence: currentSequence };
    if (processedActionSnapshot.exists()) {
      transaction.set(roomRef, { status: 'playing', startStatus: 'playing', startCountdownUntil: 0 }, { merge: true });
      return {
        status: 'duplicate' as const,
        turnVersion: Number(processedActionSnapshot.data().turnVersion ?? currentVersion),
        lastSequence: Number(processedActionSnapshot.data().sequence ?? currentSequence),
      };
    }
    const alreadyInitializedForVersion = Number(currentState?.startRequestVersion ?? 0) === meta.startRequestVersion
      && Array.isArray(currentState?.pieces)
      && currentState.pieces.length > 0;
    if (alreadyInitializedForVersion) {
      transaction.set(roomRef, { status: 'playing', startStatus: 'playing', startCountdownUntil: 0 }, { merge: true });
      transaction.set(processedActionRef, { clientMutationId: meta.clientMutationId, sequence: currentSequence, turnVersion: currentVersion, type: 'game_initialized', actorId: meta.actorId, createdAt: serverTimestamp() });
      return { status: 'duplicate' as const, turnVersion: currentVersion, lastSequence: currentSequence };
    }
    const nextVersion = currentVersion + 1;
    const nextSequence = currentSequence + 1;
    const sequenceRef = doc(db!, 'rooms', roomId, 'sequences', makeSequenceDocId(nextSequence));
    transaction.set(sequenceRef, {
      sequence: nextSequence,
      type: 'game_initialized',
      actorId: meta.actorId,
      payload: sanitizeForFirestore(meta.payload ?? { startRequestVersion: meta.startRequestVersion }) as Record<string, unknown>,
      ...makeSequenceEventFields({ stateBefore: currentState, stateAfter: state }),
      expectedPreviousSequence: currentSequence,
      clientMutationId: meta.clientMutationId,
      clientCreatedAt: Date.now(),
      createdAt: serverTimestamp(),
    });
    transaction.set(gameStateRef, { ...makeFirestoreStateData(state), updatedAt: serverTimestamp(), turnVersion: nextVersion, lastSequence: nextSequence, lastClientMutationId: meta.clientMutationId }, { merge: true });
    transaction.set(roomRef, { status: 'playing', startStatus: 'playing', startCountdownUntil: 0 }, { merge: true });
    transaction.set(processedActionRef, { clientMutationId: meta.clientMutationId, sequence: nextSequence, turnVersion: nextVersion, type: 'game_initialized', actorId: meta.actorId, createdAt: serverTimestamp() });
    return { status: 'committed' as const, turnVersion: nextVersion, lastSequence: nextSequence };
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
    transaction.set(gameStateRef, { ...makeFirestoreStateData(patch), updatedAt: serverTimestamp(), turnVersion: nextVersion }, { merge: true });
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
    const statePatch = {
      turnOrderIntro: null,
      gameStartedAt: Number(currentState.gameStartedAt ?? 0) || Date.now(),
    };
    const sequenceRef = doc(db!, 'rooms', roomId, 'sequences', makeSequenceDocId(nextSequence));
    transaction.set(sequenceRef, {
      sequence: nextSequence,
      type: 'turn_order_intro_completed',
      actorId: params.actorId,
      payload: sanitizeForFirestore({ readyAt: params.readyAt }) as Record<string, unknown>,
      ...makeSequenceEventFields({ stateBefore: currentState, stateAfter: { ...currentState, ...statePatch }, patch: statePatch }),
      expectedPreviousSequence: currentSequence,
      clientMutationId,
      clientCreatedAt: Date.now(),
      createdAt: serverTimestamp(),
    });
    transaction.set(gameStateRef, {
      ...makeFirestoreStateData(statePatch),
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

export async function resolveTurnOrderIntro(roomId: string, patch: GameStatePatch, meta: { actorId: string; startRequestVersion: number; clientMutationId: string; payload?: Record<string, unknown> }): Promise<SaveGameStateResult> {
  if (!db || !roomId) return { status: 'unavailable' };
  const gameStateRef = doc(db, 'rooms', roomId, 'state', 'current');
  const processedActionRef = getClientMutationDocRef(roomId, meta.clientMutationId);
  return runTransaction(db, async (transaction) => {
    const processedActionSnapshot = await transaction.get(processedActionRef);
    const snapshot = await transaction.get(gameStateRef);
    if (!snapshot.exists()) return { status: 'unavailable' as const };
    const currentState = snapshot.data() as SyncedGameState;
    const currentVersion = Number(currentState.turnVersion ?? 0);
    const currentSequence = Number(currentState.lastSequence ?? 0);
    if (processedActionSnapshot.exists()) return {
      status: 'duplicate' as const,
      turnVersion: Number(processedActionSnapshot.data().turnVersion ?? currentVersion),
      lastSequence: Number(processedActionSnapshot.data().sequence ?? currentSequence),
    };
    if (Number(currentState.startRequestVersion ?? 0) !== meta.startRequestVersion) return { status: 'sequence_mismatch' as const, turnVersion: currentVersion, lastSequence: currentSequence };
    if ((currentState.turnOrderIds?.length ?? 0) > 0) {
      transaction.set(processedActionRef, {
        clientMutationId: meta.clientMutationId,
        sequence: currentSequence,
        turnVersion: currentVersion,
        type: 'turn_order_resolved',
        actorId: meta.actorId,
        createdAt: serverTimestamp(),
      });
      return { status: 'duplicate' as const, turnVersion: currentVersion, lastSequence: currentSequence };
    }
    const nextVersion = currentVersion + 1;
    const nextSequence = currentSequence + 1;
    const stateAfter = { ...currentState, ...patch };
    const sequenceRef = doc(db!, 'rooms', roomId, 'sequences', makeSequenceDocId(nextSequence));
    transaction.set(sequenceRef, {
      sequence: nextSequence,
      type: 'turn_order_resolved',
      actorId: meta.actorId,
      payload: sanitizeForFirestore(meta.payload ?? {}) as Record<string, unknown>,
      ...makeSequenceEventFields({ stateBefore: currentState, stateAfter, patch }),
      expectedPreviousSequence: currentSequence,
      clientMutationId: meta.clientMutationId,
      clientCreatedAt: Date.now(),
      createdAt: serverTimestamp(),
    });
    transaction.set(gameStateRef, {
      ...makeFirestoreStateData(patch),
      updatedAt: serverTimestamp(),
      turnVersion: nextVersion,
      lastSequence: nextSequence,
      lastClientMutationId: meta.clientMutationId,
    }, { merge: true });
    transaction.set(processedActionRef, {
      clientMutationId: meta.clientMutationId,
      sequence: nextSequence,
      turnVersion: nextVersion,
      type: 'turn_order_resolved',
      actorId: meta.actorId,
      createdAt: serverTimestamp(),
    });
    return { status: 'committed' as const, turnVersion: nextVersion, lastSequence: nextSequence };
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

export async function getProcessedGameAction(roomId: string, clientMutationId: string): Promise<{ clientMutationId: string; sequence: number; turnVersion: number; type?: string; actorId?: string } | null> {
  if (!db || !roomId || !clientMutationId) return null;
  const snapshot = await getDoc(getClientMutationDocRef(roomId, clientMutationId));
  if (!snapshot.exists()) return null;
  const data = snapshot.data();
  return {
    clientMutationId,
    sequence: Number(data.sequence ?? 0),
    turnVersion: Number(data.turnVersion ?? 0),
    type: typeof data.type === 'string' ? data.type : undefined,
    actorId: typeof data.actorId === 'string' ? data.actorId : undefined,
  };
}

export async function getGameSequencesSince(roomId: string, afterSequence: number): Promise<GameSequence[]> {
  if (!db || !roomId) return [];
  const snapshot = await getDocs(query(collection(db, 'rooms', roomId, 'sequences'), where('sequence', '>', afterSequence), orderBy('sequence', 'asc')));
  return snapshot.docs.map((sequenceDoc) => ({ id: sequenceDoc.id, ...(sequenceDoc.data() as Omit<GameSequence, 'id'>) }));
}

export async function getLatestGameState(roomId: string): Promise<SyncedGameState | null> {
  if (!db || !roomId) return null;
  const snapshot = await getDoc(doc(db, 'rooms', roomId, 'state', 'current'));
  return snapshot.exists() ? snapshot.data() as SyncedGameState : null;
}

function keepNewestRoomPerHost(rooms: RoomSummary[]) {
  const latestRoomsByHost = new Map<string, RoomSummary>();
  const roomsWithoutHost: RoomSummary[] = [];
  rooms.forEach((room) => {
    if (!room.hostId) {
      roomsWithoutHost.push(room);
      return;
    }
    const currentRoom = latestRoomsByHost.get(room.hostId);
    if (!currentRoom || getCreatedAtMillis(room.createdAt) > getCreatedAtMillis(currentRoom.createdAt)) latestRoomsByHost.set(room.hostId, room);
  });
  return [...latestRoomsByHost.values(), ...roomsWithoutHost]
    .sort((a, b) => getCreatedAtMillis(b.createdAt) - getCreatedAtMillis(a.createdAt));
}

export function subscribeActiveRooms(callback: (rooms: RoomSummary[]) => void): Unsubscribe {
  if (!db) { callback([]); return () => undefined; }
  const roomsQuery = query(collection(db, 'rooms'), where('status', 'in', ['waiting', 'playing']));
  return onSnapshot(roomsQuery, (snapshot) => {
    const now = Date.now();
    const rooms = snapshot.docs
      .map((roomDoc) => ({ id: roomDoc.id, ref: roomDoc.ref, hasPendingWrites: roomDoc.metadata.hasPendingWrites, ...(roomDoc.data() as Omit<RoomSummary, 'id'>) }))
      .filter((room) => {
        const inactive = isInactiveRoom(room, now);
        if (inactive && !room.hasPendingWrites) void deleteRoom(room.id).catch((error) => console.warn('비활성 방 정리에 실패했습니다.', error));
        return !inactive;
      })
      .map(({ ref: _ref, hasPendingWrites: _hasPendingWrites, ...room }) => room);
    callback(keepNewestRoomPerHost(rooms).slice(0, MAX_ACTIVE_ROOMS));
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

export async function commitAuthoritativeGameAction(roomId: string, action: Omit<GameAction, 'id' | 'createdAt' | 'processed'>): Promise<CommitAuthoritativeGameActionResult> {
  if (!db || !roomId) return { status: 'rejected', reason: 'Firebase 환경변수가 설정되지 않았습니다.' };
  const clientActionId = typeof action.payload?.clientActionId === 'string' ? action.payload.clientActionId : `${action.type}:${action.actorId}:${Date.now()}`;
  const processedActionRef = getClientMutationDocRef(roomId, clientActionId);
  const gameStateRef = doc(db, 'rooms', roomId, 'state', 'current');
  const roomRef = doc(db, 'rooms', roomId);

  return runTransaction(db, async (transaction): Promise<CommitAuthoritativeGameActionResult> => {
    const processedActionSnapshot = await transaction.get(processedActionRef);
    if (processedActionSnapshot.exists()) return { status: 'duplicate', sequence: Number(processedActionSnapshot.data().sequence ?? 0), turnVersion: Number(processedActionSnapshot.data().turnVersion ?? 0) };
    const stateSnapshot = await transaction.get(gameStateRef);
    if (!stateSnapshot.exists()) return { status: 'rejected', reason: '아직 게임 상태가 준비되지 않았습니다.' };
    const roomSnapshot = await transaction.get(roomRef);
    if (!roomSnapshot.exists()) return { status: 'rejected', reason: '존재하지 않는 방입니다.' };
    const state = stateSnapshot.data() as SyncedGameState;
    const room = roomSnapshot.data() as Omit<RoomSummary, 'id'>;
    const actorSnapshot = await transaction.get(doc(db!, 'rooms', roomId, 'players', action.actorId));
    const actorPlayer = actorSnapshot.exists() ? actorSnapshot.data() as RoomPlayer : null;
    let coordinatorPlayerIds: string[] = [];
    const snapshotSeats = (state.gameSeats ?? []) as GameSeatSnapshot[];
    const coordinatorSeatId = snapshotSeats.find((seat) => !seat.isAI)?.id ?? '';
    if (coordinatorSeatId) {
      const coordinatorSnapshot = await transaction.get(doc(db!, 'rooms', roomId, 'players', coordinatorSeatId));
      if (coordinatorSnapshot.exists()) {
        const coordinator = coordinatorSnapshot.data() as RoomPlayer;
        coordinatorPlayerIds = [coordinatorSeatId, coordinator.playerId, coordinator.currentPlayerId, coordinator.originalPlayerId].filter((candidate): candidate is string => typeof candidate === 'string' && Boolean(candidate));
      }
    }
    const allowCoordinator = isExpiredItemPromptTimeoutRecoveryAction(state, action) || isExpiredTrapPlacementTimeoutRecoveryAction(state, action);
    if (!canAuthenticatedUserActForPlayer(action.actorId, actorPlayer, room, { coordinatorPlayerIds, allowCoordinator })) return { status: 'rejected', reason: '액션 권한을 확인할 수 없습니다.' };
    const currentVersion = Number(state.turnVersion ?? 0);
    const currentSequence = Number(state.lastSequence ?? 0);
    let actionSides: AuthoritativeSeatSide[] = [];
    if (action.type === 'move_piece' || action.type === 'use_item' || action.type === 'place_trap' || action.type === 'item_pickup_decision') {
      const turnOrderIds = state.turnOrderIds ?? [];
      const transactionSides = await Promise.all(turnOrderIds.map(async (playerId) => {
        const playerSnapshot = await transaction.get(doc(db!, 'rooms', roomId, 'players', playerId));
        if (!playerSnapshot.exists()) return null;
        const player = playerSnapshot.data() as RoomPlayer;
        return { id: playerId, team: player.team } satisfies AuthoritativeSeatSide;
      }));
      actionSides = transactionSides.filter((entry): entry is AuthoritativeSeatSide => Boolean(entry));
    }
    const reduction: AuthoritativeReduction = reduceAuthoritativeGameAction(state, action, room, actionSides);
    if (!isAuthoritativeCommitReduction(reduction)) return reduction;
    const nextVersion = currentVersion + 1;
    const nextSequence = currentSequence + 1;
    const sequenceRef = doc(db!, 'rooms', roomId, 'sequences', makeSequenceDocId(nextSequence));
    const stateAfter = {
      ...state,
      ...reduction.patch,
      turnVersion: nextVersion,
      lastSequence: nextSequence,
      lastClientMutationId: clientActionId,
    };
    const sequenceEvent: GameSequence = {
      id: makeSequenceDocId(nextSequence),
      sequence: nextSequence,
      type: action.type === 'roll_yut' ? 'roll_yut' : action.type === 'continue_race' ? 'race_continued' : action.type === 'use_item' ? 'item_used' : action.type === 'place_trap' ? 'trap_placed' : action.type === 'item_pickup_decision' ? 'item_pickup_decided' : 'move_piece_resolved',
      actorId: action.actorId,
      payload: sanitizeForFirestore(reduction.payload) as Record<string, unknown>,
      ...makeSequenceEventFields({ stateBefore: state, stateAfter, patch: reduction.patch, action }),
      expectedPreviousSequence: currentSequence,
      clientMutationId: clientActionId,
      clientCreatedAt: Date.now(),
      createdAt: serverTimestamp(),
    };
    const { id: _sequenceEventId, ...sequenceEventData } = sequenceEvent;
    transaction.set(sequenceRef, sequenceEventData);
    transaction.set(gameStateRef, { ...makeFirestoreStateData(reduction.patch), updatedAt: serverTimestamp(), turnVersion: nextVersion, lastSequence: nextSequence, lastClientMutationId: clientActionId }, { merge: true });
    transaction.set(processedActionRef, { clientMutationId: clientActionId, sequence: nextSequence, turnVersion: nextVersion, type: action.type, actorId: action.actorId, createdAt: serverTimestamp() });
    return { status: 'committed', sequence: nextSequence, turnVersion: nextVersion, patch: reduction.patch, payload: reduction.payload, stateAfter, sequenceEvent };
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

export async function updateRoomOptions(roomId: string, params: Partial<Pick<RoomSummary, 'itemMode' | 'stackedRollMode' | 'pieceCount' | 'playMode' | 'maxPlayers'>>) {
  if (!db) throw new Error('Firebase 환경변수가 설정되지 않았습니다.');
  const roomRef = doc(db, 'rooms', roomId);
  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(roomRef);
    const currentVersion = Number((snapshot.data() as Partial<RoomSummary> | undefined)?.roomConfigVersion ?? 0);
    transaction.set(roomRef, { ...params, roomConfigVersion: currentVersion + 1 }, { merge: true });
  });
}

export async function claimRoomHostIfMissing(roomId: string, candidatePlayerId: string) {
  if (!db || !roomId || !candidatePlayerId) return null;
  const roomRef = doc(db, 'rooms', roomId);
  const candidateRef = doc(db, 'rooms', roomId, 'players', candidatePlayerId);
  return runTransaction(db, async (transaction) => {
    const roomSnapshot = await transaction.get(roomRef);
    if (!roomSnapshot.exists()) return null;
    const room = roomSnapshot.data() as Omit<RoomSummary, 'id'>;
    if (room.status !== 'waiting') return room.hostId ?? null;

    const currentHostId = room.hostId ?? '';
    let currentHostSeatIndex: number | null = null;
    if (currentHostId) {
      const currentHostSnapshot = await transaction.get(doc(db!, 'rooms', roomId, 'players', currentHostId));
      const currentHost = currentHostSnapshot.exists() ? currentHostSnapshot.data() as RoomPlayer : null;
      if (currentHost && !currentHost.isSpectator && !currentHost.isAI) return currentHostId;
      currentHostSeatIndex = currentHost && Number.isFinite(Number(currentHost.seatIndex)) ? Number(currentHost.seatIndex) : null;
    }

    const candidateSnapshot = await transaction.get(candidateRef);
    if (!candidateSnapshot.exists()) return null;
    const candidate = candidateSnapshot.data() as RoomPlayer;
    if (candidate.isSpectator || candidate.isAI || !Number.isFinite(Number(candidate.seatIndex))) return null;

    const candidateSeatIndex = Number(candidate.seatIndex);
    transaction.set(roomRef, { hostId: candidatePlayerId, emptySince: null }, { merge: true });
    if (currentHostSeatIndex !== null && currentHostSeatIndex !== candidateSeatIndex) transaction.set(doc(db!, 'rooms', roomId, 'seats', String(currentHostSeatIndex)), { isHost: false, updatedAt: serverTimestamp() }, { merge: true });
    transaction.set(doc(db!, 'rooms', roomId, 'seats', String(candidateSeatIndex)), { isHost: true, updatedAt: serverTimestamp() }, { merge: true });
    transaction.set(candidateRef, { ready: true, isSpectator: false, lastSeen: serverTimestamp() }, { merge: true });
    return candidatePlayerId;
  });
}

export async function updateRoomPlayer(roomId: string, playerId: string, params: Partial<Omit<RoomPlayer, 'id'>>) {
  if (!db) throw new Error('Firebase 환경변수가 설정되지 않았습니다.');
  await setDoc(doc(db, 'rooms', roomId, 'players', playerId), params, { merge: true });
  if (typeof params.seatIndex === 'number' && !params.isSpectator) {
    const aiActive = Boolean(params.isAI);
    await setDoc(doc(db, 'rooms', roomId, 'seats', String(params.seatIndex)), {
      playerId,
      originalPlayerId: playerId,
      currentPlayerId: playerId,
      ...(params.nickname ? { nickname: params.nickname } : {}),
      ...(params.color ? { color: params.color } : {}),
      ...(params.team ? { team: params.team } : {}),
      seatIndex: params.seatIndex,
      label: `P${params.seatIndex + 1}`,
      aiActive,
      isSubstitutedByAI: Boolean(params.isSubstitutedByAI),
      ...(aiActive && !params.isSubstitutedByAI && params.nickname ? { aiName: params.nickname } : {}),
      ...(params.isSubstitutedByAI ? { aiName: '' } : {}),
      status: params.isSubstitutedByAI ? 'ai_substitute' : 'human',
      updatedAt: serverTimestamp(),
    }, { merge: true });
  }
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

export async function removeRoomPlayer(roomId: string, playerId: string, options: { preservePlayingSeatAsAi?: boolean } = {}) {
  if (!db) throw new Error('Firebase 환경변수가 설정되지 않았습니다.');
  const roomRef = doc(db, 'rooms', roomId);
  const roomSnapshot = await getDoc(roomRef);
  const room = roomSnapshot.exists() ? roomSnapshot.data() as Omit<RoomSummary, 'id'> : null;
  const playerRef = doc(db, 'rooms', roomId, 'players', playerId);
  const playerSnapshot = await getDoc(playerRef);
  const player = playerSnapshot.exists() ? playerSnapshot.data() as RoomPlayer : null;
  const preservePlayingSeatAsAi = options.preservePlayingSeatAsAi ?? true;
  const shouldPreserveSeatAsAi = preservePlayingSeatAsAi && (room?.status === 'playing' || room?.startStatus === 'entering' || room?.startStatus === 'playing');
  if (shouldPreserveSeatAsAi && player && !player.isSpectator && Number.isFinite(Number(player.seatIndex))) {
    await setDoc(playerRef, {
      nickname: player.nickname || '플레이어',
      ready: true,
      isAI: true,
      isSubstitutedByAI: true,
      isSpectator: false,
      lastSeen: serverTimestamp(),
    }, { merge: true });
    await setDoc(doc(db, 'rooms', roomId, 'seats', String(player.seatIndex)), { playerId, originalPlayerId: playerId, currentPlayerId: playerId, nickname: player.nickname, color: player.color, team: player.team, seatIndex: Number(player.seatIndex), label: `P${Number(player.seatIndex) + 1}`, aiActive: true, aiName: '', isSubstitutedByAI: true, status: 'ai_substitute', updatedAt: serverTimestamp() }, { merge: true });
    await syncRoomPlayerCount(roomId);
    await setDoc(roomRef, { emptySince: null }, { merge: true });
    return;
  }
  await deleteDoc(playerRef);
  if (player && !player.isSpectator && Number.isFinite(Number(player.seatIndex))) {
    await setDoc(doc(db, 'rooms', roomId, 'seats', String(player.seatIndex)), {
      playerId,
      originalPlayerId: playerId,
      currentPlayerId: playerId,
      nickname: player.nickname,
      color: player.color,
      team: player.team,
      seatIndex: Number(player.seatIndex),
      label: `P${Number(player.seatIndex) + 1}`,
      aiActive: false,
      status: 'disconnected',
      updatedAt: serverTimestamp(),
    }, { merge: true });
  }
  await syncRoomPlayerCount(roomId);
  const remainingPlayersSnapshot = await getDocs(query(collection(db, 'rooms', roomId, 'players'), orderBy('seatIndex', 'asc')));
  const remainingPlayers = remainingPlayersSnapshot.docs.map((playerDoc) => ({ id: playerDoc.id, ...(playerDoc.data() as Omit<RoomPlayer, 'id'>) }));
  const remainingHumanPlayers = remainingPlayers.filter((remainingPlayer) => !remainingPlayer.isSpectator && !remainingPlayer.isAI);
  if (!remainingHumanPlayers.length) {
    await deleteRoom(roomId);
    return;
  }
  await setDoc(roomRef, { emptySince: null }, { merge: true });
}

export async function updateRoomStatus(roomId: string, status: RoomSummary['status']) {
  if (!db) throw new Error('Firebase 환경변수가 설정되지 않았습니다.');
  await updateDoc(doc(db, 'rooms', roomId), {
    status,
    ...(status === 'playing' ? { startCountdownUntil: 0, startStatus: 'playing' } : {}),
    ...(status === 'waiting' ? { startCountdownUntil: 0, startCountdownStartsAt: 0, startCountdownEndsAt: 0, startStatus: 'idle' } : {}),
  });
}

export async function updateRoomStartCountdown(roomId: string, startCountdownUntil: number) {
  if (!db) throw new Error('Firebase 환경변수가 설정되지 않았습니다.');
  await updateDoc(doc(db, 'rooms', roomId), { startCountdownUntil });
}

export async function requestRoomGameStart(roomId: string, requestedAt: number) {
  if (!db) throw new Error('Firebase 환경변수가 설정되지 않았습니다.');
  const roomRef = doc(db, 'rooms', roomId);
  return runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(roomRef);
    if (!snapshot.exists()) throw new Error('존재하지 않는 방입니다.');
    const room = snapshot.data() as RoomSummary;
    const nextVersion = Number(room.startRequestVersion ?? 0) + 1;
    const startsAt = requestedAt + 1000;
    const endsAt = startsAt + 5000;
    transaction.set(roomRef, {
      startRequestVersion: nextVersion,
      startRequestedAt: requestedAt,
      startCountdownStartsAt: startsAt,
      startCountdownEndsAt: endsAt,
      startCountdownUntil: endsAt,
      startCancelledAt: null,
      startStatus: 'requested',
    }, { merge: true });
    return { startRequestVersion: nextVersion, startRequestedAt: requestedAt, startCountdownStartsAt: startsAt, startCountdownEndsAt: endsAt };
  });
}

export async function cancelRoomGameStart(roomId: string, startRequestVersion: number, cancelledAt: number) {
  if (!db) throw new Error('Firebase 환경변수가 설정되지 않았습니다.');
  const roomRef = doc(db, 'rooms', roomId);
  return runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(roomRef);
    if (!snapshot.exists()) return false;
    const room = snapshot.data() as RoomSummary;
    const currentVersion = Number(room.startRequestVersion ?? 0);
    const countdownEndsAt = Number(room.startCountdownEndsAt ?? room.startCountdownUntil ?? 0);
    if (currentVersion !== startRequestVersion || room.startStatus !== 'requested' || countdownEndsAt - cancelledAt <= 2000) return false;
    transaction.set(roomRef, { startCancelledAt: cancelledAt, startStatus: 'cancelled', startCountdownUntil: 0 }, { merge: true });
    return true;
  });
}

export async function markRoomGameEntering(roomId: string, startRequestVersion: number) {
  if (!db) throw new Error('Firebase 환경변수가 설정되지 않았습니다.');
  const roomRef = doc(db, 'rooms', roomId);
  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(roomRef);
    if (!snapshot.exists()) return;
    const room = snapshot.data() as RoomSummary;
    if (Number(room.startRequestVersion ?? 0) !== startRequestVersion) return;
    if (room.status === 'playing' || room.startStatus === 'playing') return;
    transaction.set(roomRef, { startStatus: 'entering', startRequestVersion, startCountdownUntil: 0 }, { merge: true });
  });
}

export async function deleteRoom(roomId: string) {
  if (!db) return;
  await deleteRoomSubcollections(roomId);
  await deleteDoc(doc(db, 'rooms', roomId));
}
