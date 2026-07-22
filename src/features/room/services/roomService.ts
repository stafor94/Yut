import {
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  where,
  writeBatch,
  type Unsubscribe,
} from 'firebase/firestore';
import { buildPreparedRoomGameState, isCompleteRoomGamePlayerSnapshot } from '../../../app/flows/gameStartPreparation';
import { db } from '../../../services/firebase/firebaseDb';
import { waitForGamePresentationBeforeAction } from '../../../shared/gamePresentationLock';
import {
  commitAuthoritativeGameAction as commitAuthoritativeGameActionCore,
  createRoom as createRoomCore,
  getGameSequencesSince as getGameSequencesSinceCore,
  getProcessedGameAction as getProcessedGameActionCore,
  initializeGameState as initializeGameStateCore,
  isRoomInGame as isRoomInGameCore,
  joinRoom as joinRoomCore,
  removeRoomPlayer as removeRoomPlayerCore,
  subscribeGameState as subscribeGameStateCore,
  updateRoomPlayer as updateRoomPlayerCore,
  updateRoomStatus as updateRoomStatusCore,
  type CommitAuthoritativeGameActionResult,
  type GameAction,
  type GameSequence,
  type JoinRoomResult,
  type RoomPlayer,
  type RoomSummary,
  type SyncedGameState,
} from './roomServiceCore';
import { settleAuthoritativeCommit } from './authoritativeCommitTimeout';
import {
  resolveFallPresentationCompletionLocally,
  shouldWaitForGamePresentationBeforeCommit,
} from './fallPresentationCommitPolicy';
import { isAiSubstitutionUpdate } from './roomExitPolicy';
import {
  ROOM_LIST_CANDIDATE_LIMIT,
  countConnectedHumanRoomPlayers,
  getRoomLastActivityMillis,
  isManualAiSeatPlayerUpdate,
  isRoomSummaryInactive,
} from './roomLifecyclePolicy';
import {
  cleanupDeletionCandidatesBeforeCreate,
  deleteRoomSafely,
  getManagedRoom,
  getRoomPlayers,
  reconcileRoomDeletionGrace,
  type ManagedRoomSummary,
  type RoomDeletionGuard,
} from './roomLifecycleStore';
import { createRoomSafely } from './roomCreationService';
import { joinRoomSafely } from './roomJoinService';
import { cleanupCurrentRoomPresenceSafely } from './roomPresenceCleanupService';
import {
  drainPendingRoomCleanups,
  leaveDuplicatePlayerRoomsSafely,
  queuePendingRoomCleanup,
  removeRoomPlayerNow,
  removeRoomPlayerSafely,
} from './roomExitService';
import {
  clearCachedGameSequences,
  getCachedGameSequencesForReplay,
  hasCachedGameSequence,
  replaceCachedGameSequences,
} from './roomSequenceReplayCache';
import { normalizeLegacyRollTimingAction } from './rollTimingActionCompatibility';

export * from './roomServiceCore';
export * from './roomExitPolicy';
export * from './roomAvailabilityPolicy';
export * from './roomLifecyclePolicy';
export { withGameSequenceReplayCache } from './roomSequenceReplayCache';

const RECENT_GAME_SEQUENCE_CACHE_LIMIT = 8;

export function subscribeGameState(roomId: string, callback: (state: SyncedGameState | null) => void): Unsubscribe {
  if (!db) return subscribeGameStateCore(roomId, callback);

  let pendingState: SyncedGameState | null | undefined;
  let deliveredInitialState = false;
  let flushTimer: ReturnType<typeof setTimeout> | null = null;

  const clearFlushTimer = () => {
    if (flushTimer === null) return;
    clearTimeout(flushTimer);
    flushTimer = null;
  };
  const flushPendingState = () => {
    if (pendingState === undefined) return;
    const state = pendingState;
    pendingState = undefined;
    clearFlushTimer();
    deliveredInitialState = true;
    callback(state);
  };
  const flushWhenSequenceReady = () => {
    if (pendingState === undefined) return;
    if (!pendingState) {
      flushPendingState();
      return;
    }
    const targetSequence = Number(pendingState.lastSequence ?? 0);
    if (targetSequence <= 0 || hasCachedGameSequence(roomId, targetSequence)) flushPendingState();
  };

  const recentSequencesQuery = query(
    collection(db, 'rooms', roomId, 'sequences'),
    orderBy('sequence', 'desc'),
    limit(RECENT_GAME_SEQUENCE_CACHE_LIMIT),
  );
  const unsubscribeSequences = onSnapshot(recentSequencesQuery, (snapshot) => {
    replaceCachedGameSequences(
      roomId,
      snapshot.docs.map((sequenceDoc) => ({ id: sequenceDoc.id, ...(sequenceDoc.data() as Omit<GameSequence, 'id'>) })),
      RECENT_GAME_SEQUENCE_CACHE_LIMIT,
    );
    flushWhenSequenceReady();
  });
  const unsubscribeState = subscribeGameStateCore(roomId, (state) => {
    pendingState = state;
    if (!deliveredInitialState || !state) {
      flushPendingState();
      return;
    }
    flushWhenSequenceReady();
    if (pendingState !== undefined && flushTimer === null) {
      flushTimer = setTimeout(() => {
        flushTimer = null;
        flushPendingState();
      }, 0);
    }
  });

  return () => {
    clearFlushTimer();
    unsubscribeState();
    unsubscribeSequences();
    clearCachedGameSequences(roomId);
  };
}

export async function getGameSequencesSince(roomId: string, afterSequence: number): Promise<GameSequence[]> {
  const cachedSequences = getCachedGameSequencesForReplay<GameSequence>(roomId, afterSequence);
  if (cachedSequences) return cachedSequences;
  return getGameSequencesSinceCore(roomId, afterSequence);
}

export function isRoomInGame(room: Parameters<typeof isRoomInGameCore>[0]) {
  return room.status === 'finished' || isRoomInGameCore(room);
}

const sortRoomsByLastActivity = (rooms: RoomSummary[]) => [...rooms]
  .sort((left, right) => getRoomLastActivityMillis(right) - getRoomLastActivityMillis(left));

export function subscribeActiveRooms(callback: (rooms: RoomSummary[]) => void): Unsubscribe {
  if (!db) { callback([]); return () => undefined; }
  void drainPendingRoomCleanups();
  void cleanupDeletionCandidatesBeforeCreate().catch((error) => console.warn('방 목록 조회 전 만료 방 정리에 실패했습니다.', error));
  const roomsQuery = query(collection(db, 'rooms'), where('status', 'in', ['waiting', 'playing', 'finished']));
  return onSnapshot(roomsQuery, (snapshot) => {
    const rooms = snapshot.docs
      .map((roomDoc) => ({ id: roomDoc.id, ...(roomDoc.data() as Omit<RoomSummary, 'id'>) }))
      .filter((room) => !isRoomSummaryInactive(room as ManagedRoomSummary));
    callback(sortRoomsByLastActivity(rooms).slice(0, ROOM_LIST_CANDIDATE_LIMIT));
  }, () => callback([]));
}

type CommittableGameAction = Omit<GameAction, 'id' | 'createdAt' | 'processed'>;

const settleRoomAction = (
  roomId: string,
  action: CommittableGameAction,
): Promise<CommitAuthoritativeGameActionResult> => {
  const normalizedAction = normalizeLegacyRollTimingAction(action);
  const clientActionId = typeof normalizedAction.payload?.clientActionId === 'string' ? normalizedAction.payload.clientActionId : '';
  return settleAuthoritativeCommit({
    actionType: normalizedAction.type,
    commit: () => commitAuthoritativeGameActionCore(roomId, normalizedAction),
    recoverProcessed: clientActionId ? () => getProcessedGameActionCore(roomId, clientActionId) : undefined,
  });
};

export async function commitAuthoritativeGameAction(
  roomId: string,
  action: CommittableGameAction,
): Promise<CommitAuthoritativeGameActionResult> {
  const localFallCompletion = resolveFallPresentationCompletionLocally(action);
  if (localFallCompletion) return localFallCompletion;

  if (shouldWaitForGamePresentationBeforeCommit(action)) {
    await waitForGamePresentationBeforeAction(action.type);
  }
  const result = await settleRoomAction(roomId, action);
  if (db && (result.status === 'committed' || result.status === 'duplicate')) {
    void setDoc(doc(db, 'rooms', roomId), { lastActivityAt: Date.now() }, { merge: true }).catch(() => undefined);
  }
  return result;
}

export async function createRoom(params: Parameters<typeof createRoomCore>[0]) {
  return createRoomSafely(params);
}

export async function initializeGameState(...args: Parameters<typeof initializeGameStateCore>) {
  const [roomId, _clientState, meta] = args;
  const [room, players] = await Promise.all([getManagedRoom(roomId), getRoomPlayers(roomId)]);
  if (!room) return { status: 'unavailable' as const };
  if (!isCompleteRoomGamePlayerSnapshot(room, players)) return { status: 'sequence_mismatch' as const };

  const countdownEndsAt = Number(room.startCountdownEndsAt ?? room.startCountdownUntil ?? 0);
  if (!countdownEndsAt) return { status: 'sequence_mismatch' as const };

  const authoritativeState = buildPreparedRoomGameState({
    roomId,
    room,
    players,
    startRequestVersion: meta.startRequestVersion,
    startRequestId: meta.startRequestId,
    countdownEndsAt,
  });
  return initializeGameStateCore(roomId, authoritativeState, meta);
}

export async function joinRoom(...args: Parameters<typeof joinRoomCore>): Promise<JoinRoomResult> {
  const [roomId, params] = args;
  const result = await joinRoomSafely(...args);
  const players = await getRoomPlayers(roomId);
  if (db) {
    await setDoc(doc(db, 'rooms', roomId), {
      currentPlayers: countConnectedHumanRoomPlayers(players),
      emptySince: null,
      lastActivityAt: Date.now(),
    }, { merge: true });
  }
  void leaveDuplicatePlayerRoomsSafely(params.userId, roomId).catch((error) => console.warn('입장 후 중복 방 정리에 실패했습니다.', error));
  return result;
}

export async function removeRoomPlayer(...args: Parameters<typeof removeRoomPlayerCore>) {
  return removeRoomPlayerSafely(...args);
}

export async function leaveDuplicatePlayerRooms(playerId: string, keepRoomId = '') {
  return leaveDuplicatePlayerRoomsSafely(playerId, keepRoomId);
}

export async function deleteRoom(roomId: string, guard: RoomDeletionGuard = {}) {
  return deleteRoomSafely(roomId, guard);
}

export async function heartbeatRoomPlayer(roomId: string, playerId: string) {
  if (!db || !roomId || !playerId) return false;
  try {
    const batch = writeBatch(db);
    batch.set(doc(db, 'rooms', roomId, 'players', playerId), { lastSeen: serverTimestamp() }, { merge: true });
    batch.set(doc(db, 'rooms', roomId), {
      lastHumanSeenAt: serverTimestamp(),
      emptySince: null,
      lastActivityAt: serverTimestamp(),
    }, { merge: true });
    await batch.commit();
    return true;
  } catch {
    return false;
  }
}

const updateManualAiSeatPlayer = async (
  roomId: string,
  playerId: string,
  params: Partial<Omit<RoomPlayer, 'id'>>,
) => {
  if (!db || typeof params.seatIndex !== 'number') throw new Error('Firebase 환경변수가 설정되지 않았습니다.');
  const seatIndex = params.seatIndex;
  const batch = writeBatch(db);
  batch.set(doc(db, 'rooms', roomId, 'players', playerId), params, { merge: true });
  batch.set(doc(db, 'rooms', roomId, 'seats', String(seatIndex)), {
    playerId,
    originalPlayerId: playerId,
    currentPlayerId: playerId,
    ...(params.nickname ? { nickname: params.nickname } : {}),
    ...(params.color ? { color: params.color } : {}),
    ...(params.team ? { team: params.team } : {}),
    seatIndex,
    label: `P${seatIndex + 1}`,
    aiActive: true,
    isSubstitutedByAI: false,
    ...(params.nickname ? { aiName: params.nickname } : {}),
    status: 'human',
    updatedAt: serverTimestamp(),
  }, { merge: true });
  batch.set(doc(db, 'rooms', roomId), { lastActivityAt: Date.now() }, { merge: true });
  await batch.commit();
};

export async function updateRoomPlayer(roomId: string, playerId: string, params: Partial<Omit<RoomPlayer, 'id'>>) {
  const atomicAiSubstitution = isAiSubstitutionUpdate(params);
  const manualAiSeatUpdate = isManualAiSeatPlayerUpdate(playerId, params);
  try {
    if (atomicAiSubstitution) {
      await removeRoomPlayerNow(roomId, playerId, { preservePlayingSeatAsAi: true });
    } else if (manualAiSeatUpdate) {
      await updateManualAiSeatPlayer(roomId, playerId, params);
    } else {
      await updateRoomPlayerCore(roomId, playerId, params);
    }
  } catch (error) {
    if (atomicAiSubstitution) queuePendingRoomCleanup({ roomId, playerId, preservePlayingSeatAsAi: true });
    throw error;
  }
  if (manualAiSeatUpdate) return;
  const players = await getRoomPlayers(roomId);
  if (db) {
    await setDoc(doc(db, 'rooms', roomId), {
      currentPlayers: countConnectedHumanRoomPlayers(players),
      lastActivityAt: Date.now(),
    }, { merge: true });
  }
}

export async function updateRoomStatus(roomId: string, status: RoomSummary['status']) {
  await updateRoomStatusCore(roomId, status);
  if (!db) return;
  if (status === 'waiting') {
    const [room, players] = await Promise.all([getManagedRoom(roomId), getRoomPlayers(roomId)]);
    const remainingPlayers = players.filter((player) => !player.isSubstitutedByAI);
    const batch = writeBatch(db);
    players.forEach((player) => {
      if (player.isSubstitutedByAI) {
        batch.delete(doc(db!, 'rooms', roomId, 'players', player.id));
        if (Number.isInteger(Number(player.seatIndex)) && Number(player.seatIndex) >= 0) batch.delete(doc(db!, 'rooms', roomId, 'seats', String(Number(player.seatIndex))));
        return;
      }
      if (!player.isAI && player.id !== room?.hostId && player.ready) batch.set(doc(db!, 'rooms', roomId, 'players', player.id), { ready: false }, { merge: true });
    });
    batch.set(doc(db, 'rooms', roomId), {
      currentPlayers: countConnectedHumanRoomPlayers(remainingPlayers),
      emptySince: null,
      deletingAt: null,
      lastActivityAt: Date.now(),
    }, { merge: true });
    await batch.commit();
    await reconcileRoomDeletionGrace(roomId, Date.now(), { allowGraceClear: true, allowGraceStart: true });
    return;
  }
  await setDoc(doc(db, 'rooms', roomId), { lastActivityAt: Date.now(), deletingAt: null }, { merge: true });
  await reconcileRoomDeletionGrace(roomId, Date.now(), { allowGraceClear: true, allowGraceStart: true });
}

export async function cleanupCurrentRoomPresence(...args: Parameters<typeof cleanupCurrentRoomPresenceSafely>) {
  const [roomId] = args;
  const [roomBefore, playersBefore] = await Promise.all([getManagedRoom(roomId), getRoomPlayers(roomId)]);
  const seatIndexByPlayerId = new Map(playersBefore.map((player) => [player.id, Number(player.seatIndex)]));
  const result = await cleanupCurrentRoomPresenceSafely(...args);

  if (result.cleanedPlayerIds.length && db) {
    const playersAfter = await getRoomPlayers(roomId);
    const batch = writeBatch(db);
    if (roomBefore?.status === 'waiting') {
      result.cleanedPlayerIds.forEach((playerId) => {
        const seatIndex = seatIndexByPlayerId.get(playerId);
        if (Number.isInteger(seatIndex) && Number(seatIndex) >= 0) batch.delete(doc(db!, 'rooms', roomId, 'seats', String(seatIndex)));
      });
    }
    batch.set(doc(db, 'rooms', roomId), {
      currentPlayers: countConnectedHumanRoomPlayers(playersAfter),
      lastActivityAt: Date.now(),
    }, { merge: true });
    await batch.commit();
  }

  await reconcileRoomDeletionGrace(roomId, Date.now(), { allowGraceClear: true, allowGraceStart: true });
  return result;
}

export async function cleanupInactiveRooms(protectedRoomId = '') {
  return cleanupDeletionCandidatesBeforeCreate(protectedRoomId);
}

export async function scheduleEmptyRoomDeletion(roomId: string) {
  if (!db || !roomId) return false;
  return reconcileRoomDeletionGrace(roomId);
}
