import { collection, doc, getDoc, runTransaction, serverTimestamp, writeBatch } from 'firebase/firestore';
import { db } from '../../../services/firebase/firebaseDb';
import { spawnInitialBoardItems } from '../../../game-core/board/board';
import {
  createRoom as createRoomCore,
  type RoomPlayer,
} from './roomServiceCore';
import {
  cleanupDeletionCandidatesBeforeCreate,
  getActivePlayerRoomMemberships,
  getActiveRoomsWithPlayers,
  type ManagedRoomSummary,
} from './roomLifecycleStore';
import { hasActiveHumanLifecyclePlayer, hasResumablePlayerForUser } from './roomLifecyclePolicy';
import { removeRoomPlayerNow } from './roomExitService';
import { leavePlayerRoomsBeforeCreate } from './roomCreationCleanup';
import { waitForRoomCreationLock } from './roomCreationLock';
import { ROOM_CREATION_TIMEOUT_MS } from './roomCreationTiming';

const ACTIVE_HOST_ROOM_ERROR = '이미 진행 중인 방이 있습니다. 기존 방으로 돌아간 뒤 새 방을 만들어주세요.';
const ACTIVE_ROOM_LIMIT_ERROR = '방은 최대 3개까지만 만들 수 있습니다. 기존 방에 참여하거나 잠시 뒤 다시 시도해주세요.';
const DUPLICATE_ROOM_TITLE_ERROR = '이미 존재하는 방 제목입니다. 다른 제목을 입력해주세요.';
const CREATE_IN_PROGRESS_ERROR = '다른 방 생성 요청을 처리 중입니다. 잠시 뒤 다시 시도해주세요.';
// Firestore reserves document IDs that match the __.*__ pattern.
const ROOM_CREATION_LOCK_ID = 'system-room-creation-lock';
const ROOM_CREATION_LOCK_MS = ROOM_CREATION_TIMEOUT_MS;
const QA_ROOM_TITLE_PREFIX = 'QA-';
const QA_RUN_ID = String(import.meta.env.VITE_QA_RUN_ID ?? '').trim();
const COLORS = ['red', 'blue', 'green', 'yellow'] as const;

const isQaRoomTitle = (title: unknown) => typeof title === 'string' && title.startsWith(QA_ROOM_TITLE_PREFIX);

const createLockOwnerToken = (requestId: string) => `${requestId}:${Date.now()}:${Math.random().toString(36).slice(2)}`;

async function tryAcquireRoomCreationLock(hostId: string, requestId: string, ownerToken: string) {
  if (!db) throw new Error('Firebase 환경변수가 설정되지 않았습니다.');
  const lockRef = doc(db, 'rooms', ROOM_CREATION_LOCK_ID);
  return runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(lockRef);
    const lock = snapshot.exists() ? snapshot.data() as ManagedRoomSummary : null;
    const now = Date.now();
    if (lock && Number(lock.lockExpiresAt ?? 0) > now && lock.lockRequestId !== requestId) return false;
    transaction.set(lockRef, {
      title: '시스템 방 생성 잠금',
      hostId,
      maxPlayers: 2,
      itemMode: false,
      stackedRollMode: false,
      playMode: 'individual',
      pieceCount: 1,
      status: 'waiting',
      startStatus: 'idle',
      emptySince: null,
      currentPlayers: 0,
      systemRoomType: 'creation_lock',
      lockRequestId: requestId,
      lockOwnerToken: ownerToken,
      lockExpiresAt: now + ROOM_CREATION_LOCK_MS,
      lastActivityAt: now,
      createdAt: lock?.createdAt ?? serverTimestamp(),
    }, { merge: true });
    return true;
  });
}

async function acquireRoomCreationLock(hostId: string, requestId: string, ownerToken: string) {
  const acquired = await waitForRoomCreationLock({
    tryAcquire: () => tryAcquireRoomCreationLock(hostId, requestId, ownerToken),
  });
  if (!acquired) throw new Error(CREATE_IN_PROGRESS_ERROR);
}

async function releaseRoomCreationLock(requestId: string, ownerToken: string) {
  if (!db) return;
  const lockRef = doc(db, 'rooms', ROOM_CREATION_LOCK_ID);
  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(lockRef);
    if (!snapshot.exists()) return;
    const lock = snapshot.data() as ManagedRoomSummary;
    if (lock.lockRequestId !== requestId || lock.lockOwnerToken !== ownerToken) return;
    transaction.set(lockRef, {
      status: 'finished',
      currentPlayers: 0,
      lockExpiresAt: 0,
      lastActivityAt: Date.now(),
    }, { merge: true });
  });
}

export async function createRoomSafely(params: Parameters<typeof createRoomCore>[0]) {
  if (!db) throw new Error('Firebase 환경변수가 설정되지 않았습니다.');
  const normalizedTitle = params.title.trim();
  if (!normalizedTitle) throw new Error('방 제목을 입력해주세요.');
  const roomsRef = collection(db, 'rooms');
  const roomRef = params.roomId ? doc(roomsRef, params.roomId) : doc(roomsRef);
  const requestId = params.createRequestId || roomRef.id;
  const ownerToken = createLockOwnerToken(requestId);

  const existingSnapshot = await getDoc(roomRef);
  if (existingSnapshot.exists()) {
    const existing = existingSnapshot.data() as ManagedRoomSummary;
    if (existing.hostId === params.hostId && existing.createRequestId === params.createRequestId) return roomRef.id;
    throw new Error('같은 방 식별자가 이미 다른 요청에 사용되었습니다. 다시 시도해주세요.');
  }

  await acquireRoomCreationLock(params.hostId, requestId, ownerToken);
  try {
    await cleanupDeletionCandidatesBeforeCreate(roomRef.id);
    const memberships = await getActivePlayerRoomMemberships(params.hostId);
    await leavePlayerRoomsBeforeCreate({
      playerId: params.hostId,
      memberships,
      leaveRoom: removeRoomPlayerNow,
    });

    const idempotentSnapshot = await getDoc(roomRef);
    if (idempotentSnapshot.exists()) {
      const existing = idempotentSnapshot.data() as ManagedRoomSummary;
      if (existing.hostId === params.hostId && existing.createRequestId === params.createRequestId) return roomRef.id;
      throw new Error('같은 방 식별자가 이미 다른 요청에 사용되었습니다. 다시 시도해주세요.');
    }

    const activeRoomCandidates = await getActiveRoomsWithPlayers();
    const ownResumableRoom = activeRoomCandidates.some(({ room, players }) => (
      room.hostId === params.hostId && hasResumablePlayerForUser(players, params.hostId)
    ));
    if (ownResumableRoom) throw new Error(ACTIVE_HOST_ROOM_ERROR);
    const now = Date.now();
    const activeUserRooms = activeRoomCandidates
      .filter(({ players }) => hasActiveHumanLifecyclePlayer(players, now))
      .map(({ room }) => room)
      .filter((room) => !isQaRoomTitle(room.title));
    if (!isQaRoomTitle(normalizedTitle) && activeUserRooms.length >= 3) throw new Error(ACTIVE_ROOM_LIMIT_ERROR);
    if (activeUserRooms.some((room) => room.title.trim().toLocaleLowerCase() === normalizedTitle.toLocaleLowerCase())) throw new Error(DUPLICATE_ROOM_TITLE_ERROR);

    const batch = writeBatch(db);
    batch.set(roomRef, {
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
      startStatus: 'idle',
      emptySince: null,
      currentPlayers: 1,
      deletingAt: null,
      lastActivityAt: now,
      createdAt: serverTimestamp(),
      ...(params.createRequestId ? { createRequestId: params.createRequestId } : {}),
      ...(QA_RUN_ID ? { qaRunId: QA_RUN_ID } : {}),
    });
    batch.set(doc(db, 'rooms', roomRef.id, 'players', params.hostId), {
      nickname: params.nickname,
      ready: true,
      color: COLORS[0],
      seatIndex: 0,
      team: '청팀' satisfies RoomPlayer['team'],
      joinedAt: serverTimestamp(),
      lastSeen: serverTimestamp(),
    });
    batch.set(doc(db, 'rooms', roomRef.id, 'seats', '0'), {
      playerId: params.hostId,
      originalPlayerId: params.hostId,
      currentPlayerId: params.hostId,
      nickname: params.nickname,
      color: COLORS[0],
      team: '청팀',
      seatIndex: 0,
      label: 'P1',
      isHost: true,
      aiActive: false,
      status: 'human',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    if (params.itemMode) spawnInitialBoardItems().forEach((item) => batch.set(doc(db!, 'rooms', roomRef.id, 'boardItems', item.id), item));
    await batch.commit();
    return roomRef.id;
  } finally {
    await releaseRoomCreationLock(requestId, ownerToken).catch((error) => console.warn('방 생성 잠금 해제에 실패했습니다.', error));
  }
}
