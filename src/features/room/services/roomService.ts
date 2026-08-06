import {
  collection,
  deleteDoc,
  doc,
  getDoc,
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
  subscribeGameSequences as subscribeGameSequencesCore,
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
import { makeFirestoreSafeId } from './roomFirestore';
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
  mergeCachedGameSequences,
  replaceCachedGameSequences,
} from './roomSequenceReplayCache';
import { normalizeLegacyRollTimingAction } from './rollTimingActionCompatibility';

export * from './roomServiceCore';
export * from './roomCoordinatorLease';
export * from './roomExitPolicy';
export * from './roomAvailabilityPolicy';
export * from './roomLifecyclePolicy';
export { withGameSequenceReplayCache } from './roomSequenceReplayCache';

const RECENT_GAME_SEQUENCE_CACHE_LIMIT = 8;
const ROOM_SUMMARY_HEARTBEAT_INTERVAL_MS = 30_000;
const MANUAL_MOVE_RESERVATION_TTL_MS = 10_000;
const MOVE_RESERVATION_REEVALUATE_REASON = 'authoritative sequence가 변경되어 최신 상태 재평가가 필요합니다.';
const roomSummaryHeartbeatAtByRoomId = new Map<string, number>();

type CommittableGameAction = Omit<GameAction, 'id' | 'createdAt' | 'processed'>;

type ManualMoveReservation = {
  actorId: string;
  clientActionId: string;
  clientActionStartedAt: number;
  expiresAt: number;
};

const getClientActionId = (action: CommittableGameAction) => (
  typeof action.payload?.clientActionId === 'string' ? action.payload.clientActionId : ''
);

const getManualMoveReservationRef = (roomId: string, actorId: string) => doc(
  db!,
  'rooms',
  roomId,
  'actions',
  makeFirestoreSafeId(`manual_move_reservation:v1:${roomId}:${actorId}`),
);

const isManualPlayerMove = (action: CommittableGameAction) => {
  const clientActionId = getClientActionId(action);
  return action.type === 'move_piece'
    && Boolean(action.actorId)
    && clientActionId.startsWith(`move_piece:${action.actorId}:`)
    && action.payload?.recoveredByCoordinator !== true
    && action.payload?.deadlineAutoSubmitted !== true
    && typeof action.payload?.automationSource !== 'string'
    && typeof action.payload?.coordinatorSeatId !== 'string';
};

const getCoordinatorTimeoutDeadlineAt = (action: CommittableGameAction) => {
  if (action.type !== 'move_piece') return 0;
  const deadlineAt = Number(action.payload?.timeoutDeadlineAt ?? 0);
  const coordinatorRecovery = action.payload?.recoveredByCoordinator === true
    || typeof action.payload?.timeoutRecoveredBy === 'string';
  return coordinatorRecovery && Number.isFinite(deadlineAt) && deadlineAt > 0
    ? Math.trunc(deadlineAt)
    : 0;
};

const getQaMoveCommitDelayAfterReservationMs = () => {
  if (typeof window === 'undefined') return 0;
  const value = Number((window as typeof window & {
    __YUT_QA_DELAY_MOVE_PIECE_COMMIT_AFTER_RESERVATION_MS__?: unknown;
  }).__YUT_QA_DELAY_MOVE_PIECE_COMMIT_AFTER_RESERVATION_MS__ ?? 0);
  return Number.isFinite(value) ? Math.max(0, value) : 0;
};

const waitForDelay = (delayMs: number) => new Promise<void>((resolve) => {
  window.setTimeout(resolve, delayMs);
});

const readActiveManualMoveReservation = async (
  roomId: string,
  actorId: string,
  timeoutDeadlineAt: number,
): Promise<ManualMoveReservation | null> => {
  if (!db || !roomId || !actorId || !timeoutDeadlineAt) return null;
  const reservationRef = getManualMoveReservationRef(roomId, actorId);
  const snapshot = await getDoc(reservationRef);
  if (!snapshot.exists()) return null;
  const data = snapshot.data();
  const reservation: ManualMoveReservation = {
    actorId: String(data.actorId ?? ''),
    clientActionId: String(data.clientActionId ?? ''),
    clientActionStartedAt: Number(data.clientActionStartedAt ?? 0),
    expiresAt: Number(data.expiresAt ?? 0),
  };
  const active = data.reservationType === 'manual_move'
    && data.processed === true
    && reservation.actorId === actorId
    && reservation.clientActionId.startsWith(`move_piece:${actorId}:`)
    && Number.isFinite(reservation.clientActionStartedAt)
    && reservation.clientActionStartedAt > 0
    && reservation.clientActionStartedAt <= timeoutDeadlineAt
    && Number.isFinite(reservation.expiresAt)
    && reservation.expiresAt > Date.now();
  if (active) return reservation;
  void deleteDoc(reservationRef).catch(() => undefined);
  return null;
};

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

export function subscribeGameSequences(
  roomId: string,
  afterSequence: number,
  callback: Parameters<typeof subscribeGameSequencesCore>[2],
  onError?: Parameters<typeof subscribeGameSequencesCore>[3],
): Unsubscribe {
  return subscribeGameSequencesCore(roomId, afterSequence, (sequences, meta) => {
    if (sequences.length) mergeCachedGameSequences(roomId, sequences, RECENT_GAME_SEQUENCE_CACHE_LIMIT);
    callback(sequences, meta);
  }, onError);
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

const settleRoomAction = async (
  roomId: string,
  action: CommittableGameAction,
): Promise<CommitAuthoritativeGameActionResult> => {
  const normalizedAction = normalizeLegacyRollTimingAction(action);
  const clientActionId = getClientActionId(normalizedAction);
  const timeoutDeadlineAt = getCoordinatorTimeoutDeadlineAt(normalizedAction);
  if (timeoutDeadlineAt) {
    const pendingManualMove = await readActiveManualMoveReservation(
      roomId,
      normalizedAction.actorId,
      timeoutDeadlineAt,
    );
    if (pendingManualMove) {
      return {
        status: 'rejected',
        reason: MOVE_RESERVATION_REEVALUATE_REASON,
      };
    }
  }

  const manualMove = isManualPlayerMove(normalizedAction);
  const reservationRef = manualMove && db
    ? getManualMoveReservationRef(roomId, normalizedAction.actorId)
    : null;
  if (reservationRef) {
    const clientActionStartedAt = Number(normalizedAction.payload?.clientActionStartedAt ?? 0);
    const reservedAt = Date.now();
    await setDoc(reservationRef, {
      type: 'move_piece',
      actorId: normalizedAction.actorId,
      processed: true,
      reservationType: 'manual_move',
      clientActionId,
      clientActionStartedAt,
      reservedAt,
      expiresAt: reservedAt + MANUAL_MOVE_RESERVATION_TTL_MS,
      createdAt: serverTimestamp(),
    });
  }

  try {
    return await settleAuthoritativeCommit({
      actionType: normalizedAction.type,
      commit: async () => {
        if (shouldWaitForGamePresentationBeforeCommit(normalizedAction)) {
          const presentationWaitResult = await waitForGamePresentationBeforeAction(normalizedAction.type);
          if (presentationWaitResult === 'timeout') {
            console.warn('게임 연출 완료 대기 상한을 초과해 authoritative action 제출을 계속합니다.', {
              actionType: normalizedAction.type,
              clientActionId,
            });
          }
        }
        const qaDelayMs = reservationRef ? getQaMoveCommitDelayAfterReservationMs() : 0;
        if (qaDelayMs) await waitForDelay(qaDelayMs);
        return commitAuthoritativeGameActionCore(roomId, normalizedAction);
      },
      recoverProcessed: clientActionId ? () => getProcessedGameActionCore(roomId, clientActionId) : undefined,
    });
  } finally {
    if (reservationRef) {
      await deleteDoc(reservationRef).catch((error) => {
        console.warn('수동 이동 reservation 정리에 실패했습니다.', {
          roomId,
          actorId: normalizedAction.actorId,
          clientActionId,
          error,
        });
      });
    }
  }
};

export async function commitAuthoritativeGameAction(
  roomId: string,
  action: CommittableGameAction,
): Promise<CommitAuthoritativeGameActionResult> {
  const localFallCompletion = resolveFallPresentationCompletionLocally(action);
  if (localFallCompletion) return localFallCompletion;
  return settleRoomAction(roomId, action);
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

export async function heartbeatRoomPlayer(roomId: string, playerId: string, options: { refreshRoomSummary?: boolean; now?: number } = {}) {
  if (!db || !roomId || !playerId) return false;
  try {
    const now = options.now ?? Date.now();
    const shouldRefreshRoomSummary = Boolean(
      options.refreshRoomSummary
      && now - Number(roomSummaryHeartbeatAtByRoomId.get(roomId) ?? 0) >= ROOM_SUMMARY_HEARTBEAT_INTERVAL_MS,
    );
    if (!shouldRefreshRoomSummary) {
      await setDoc(doc(db, 'rooms', roomId, 'players', playerId), { lastSeen: serverTimestamp() }, { merge: true });
      return true;
    }
    const batch = writeBatch(db);
    batch.set(doc(db, 'rooms', roomId, 'players', playerId), { lastSeen: serverTimestamp() }, { merge: true });
    batch.set(doc(db, 'rooms', roomId), {
      lastHumanSeenAt: serverTimestamp(),
      emptySince: null,
      lastActivityAt: serverTimestamp(),
    }, { merge: true });
    await batch.commit();
    roomSummaryHeartbeatAtByRoomId.set(roomId, now);
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
