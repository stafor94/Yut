import { doc, runTransaction, serverTimestamp } from 'firebase/firestore';
import { db } from '../../../services/firebase/firebaseDb';
import { auth } from '../../../services/firebase/firebaseAuth';
import {
  deleteRoom as deleteRoomCore,
  removeRoomPlayer as removeRoomPlayerCore,
  type RoomPlayer,
  type RoomSeat,
} from './roomServiceCore';
import { shouldSubstituteRoomPlayerAsAi } from './roomExitPolicy';
import {
  getRoomLastActivityMillis,
  shouldDeferOwnRoomRemoval,
  shouldRestoreDeferredRoomPointer,
} from './roomLifecyclePolicy';
import {
  countActivePlayers,
  deleteRoomWhenNoNonAiPlayersRemain,
  getActivePlayerRoomMemberships,
  getManagedRoom,
  getRoomPlayers,
  type ManagedRoomSummary,
} from './roomLifecycleStore';

const TRANSITION_REMOVAL_DELAY_MS = 1_500;
const ACTIVE_ROOM_STORAGE_KEY = 'yut-online:activeRoomId';
const PENDING_ROOM_CLEANUP_STORAGE_KEY = 'yut-online:pendingRoomCleanup';

type PendingRoomCleanup = {
  roomId: string;
  playerId: string;
  preservePlayingSeatAsAi: boolean;
};

const transitionRemovalTimers = new Map<string, number>();
let pendingCleanupDrainInFlight = false;

const getActiveRoomIdFromStorage = () => typeof window === 'undefined' ? '' : window.localStorage.getItem(ACTIVE_ROOM_STORAGE_KEY) ?? '';
const isGameScreenActive = () => typeof document !== 'undefined' && Boolean(document.querySelector('[data-testid="app-shell"].screen-game'));

const readPendingCleanups = (): PendingRoomCleanup[] => {
  if (typeof window === 'undefined') return [];
  try {
    const value = JSON.parse(window.localStorage.getItem(PENDING_ROOM_CLEANUP_STORAGE_KEY) ?? '[]');
    return Array.isArray(value) ? value.filter((entry): entry is PendingRoomCleanup => (
      Boolean(entry)
      && typeof entry.roomId === 'string'
      && typeof entry.playerId === 'string'
      && typeof entry.preservePlayingSeatAsAi === 'boolean'
    )) : [];
  } catch {
    return [];
  }
};

const writePendingCleanups = (entries: PendingRoomCleanup[]) => {
  if (typeof window === 'undefined') return;
  if (!entries.length) {
    window.localStorage.removeItem(PENDING_ROOM_CLEANUP_STORAGE_KEY);
    return;
  }
  window.localStorage.setItem(PENDING_ROOM_CLEANUP_STORAGE_KEY, JSON.stringify(entries.slice(-10)));
};

export const queuePendingRoomCleanup = (entry: PendingRoomCleanup) => {
  const nextEntries = readPendingCleanups().filter((candidate) => candidate.roomId !== entry.roomId || candidate.playerId !== entry.playerId);
  nextEntries.push(entry);
  writePendingCleanups(nextEntries);
};

const removePendingRoomCleanup = (roomId: string, playerId: string) => {
  writePendingCleanups(readPendingCleanups().filter((entry) => entry.roomId !== roomId || entry.playerId !== playerId));
};

export async function removeRoomPlayerNow(roomId: string, playerId: string, options: { preservePlayingSeatAsAi?: boolean } = {}) {
  if (!db) throw new Error('Firebase 환경변수가 설정되지 않았습니다.');
  const [room, players] = await Promise.all([getManagedRoom(roomId), getRoomPlayers(roomId)]);
  if (!room) return;
  const observedPlayer = players.find((player) => player.id === playerId);
  if (!observedPlayer) return;
  const observedCurrentPlayers = Number(room.currentPlayers ?? countActivePlayers(players));
  const noOtherHumanPlayers = !players.some((player) => player.id !== playerId && !player.isSpectator && !player.isAI);
  const roomRef = doc(db, 'rooms', roomId);
  const playerRef = doc(db, 'rooms', roomId, 'players', playerId);

  const markedForDeletion = await runTransaction(db, async (transaction) => {
    const [freshRoomSnapshot, freshPlayerSnapshot] = await Promise.all([
      transaction.get(roomRef),
      transaction.get(playerRef),
    ]);
    if (!freshRoomSnapshot.exists() || !freshPlayerSnapshot.exists()) return false;
    const freshRoom = freshRoomSnapshot.data() as ManagedRoomSummary;
    const freshPlayer = freshPlayerSnapshot.data() as RoomPlayer;
    const currentPlayers = Number(freshRoom.currentPlayers ?? observedCurrentPlayers);
    const deletionGuardStillMatches = currentPlayers === observedCurrentPlayers
      && getRoomLastActivityMillis(freshRoom) === getRoomLastActivityMillis(room);
    const shouldFinishRoom = noOtherHumanPlayers && deletionGuardStillMatches;
    const freshSeatIndex = Number(freshPlayer.seatIndex);
    const hasFreshSeat = Number.isInteger(freshSeatIndex) && freshSeatIndex >= 0;
    const freshSeatRef = hasFreshSeat ? doc(db!, 'rooms', roomId, 'seats', String(freshSeatIndex)) : null;
    const freshSeatSnapshot = freshSeatRef ? await transaction.get(freshSeatRef) : null;
    const freshSeat = freshSeatSnapshot?.exists() ? freshSeatSnapshot.data() as RoomSeat : null;
    const shouldSubstituteAsAi = options.preservePlayingSeatAsAi !== false
      && shouldSubstituteRoomPlayerAsAi(freshRoom, freshPlayer, hasFreshSeat);

    if (shouldSubstituteAsAi && freshSeatRef) {
      const nextPresenceEpoch = Math.max(Number(freshPlayer.presenceEpoch ?? 0), Number(freshSeat?.presenceEpoch ?? 0)) + 1;
      transaction.set(playerRef, {
        nickname: freshPlayer.nickname || '플레이어',
        ready: true,
        isAI: true,
        isSubstitutedByAI: true,
        isSpectator: false,
        presenceEpoch: nextPresenceEpoch,
        substitutedAt: serverTimestamp(),
        lastSeen: serverTimestamp(),
      }, { merge: true });
      transaction.set(freshSeatRef, {
        playerId,
        originalPlayerId: playerId,
        currentPlayerId: playerId,
        nickname: freshPlayer.nickname,
        color: freshPlayer.color,
        team: freshPlayer.team,
        seatIndex: freshSeatIndex,
        label: `P${freshSeatIndex + 1}`,
        aiActive: true,
        aiName: '',
        isSubstitutedByAI: true,
        status: 'ai_substitute',
        presenceEpoch: nextPresenceEpoch,
        substitutedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }, { merge: true });
      const changedAt = Date.now();
      transaction.set(roomRef, {
        lastActivityAt: changedAt,
        ...(shouldFinishRoom ? { status: 'finished', deletingAt: changedAt } : { emptySince: null }),
      }, { merge: true });
      return shouldFinishRoom;
    }

    transaction.delete(playerRef);
    if (freshSeatRef) transaction.delete(freshSeatRef);
    const nextCurrentPlayers = Math.max(0, currentPlayers - (freshPlayer.isSpectator ? 0 : 1));
    const changedAt = Date.now();
    transaction.set(roomRef, {
      currentPlayers: nextCurrentPlayers,
      lastActivityAt: changedAt,
      ...(shouldFinishRoom ? { status: 'finished', deletingAt: changedAt } : { emptySince: null }),
    }, { merge: true });
    return shouldFinishRoom;
  });

  if (markedForDeletion) {
    await deleteRoomCore(roomId);
    return;
  }
  await deleteRoomWhenNoNonAiPlayersRemain(roomId);
}

function scheduleTransitionRoomRemoval(roomId: string, playerId: string, options: { preservePlayingSeatAsAi?: boolean }) {
  if (typeof window === 'undefined') return;
  const key = `${roomId}:${playerId}`;
  if (transitionRemovalTimers.has(key)) return;
  const timerId = window.setTimeout(() => {
    transitionRemovalTimers.delete(key);
    void getActivePlayerRoomMemberships(playerId)
      .then(async (memberships) => {
        const hasOtherMembership = memberships.some((membership) => membership.room.id !== roomId);
        if (!hasOtherMembership) {
          removePendingRoomCleanup(roomId, playerId);
          if (shouldRestoreDeferredRoomPointer({
            hasOtherMembership,
            activeRoomId: getActiveRoomIdFromStorage(),
          })) window.localStorage.setItem(ACTIVE_ROOM_STORAGE_KEY, roomId);
          return;
        }
        await removeRoomPlayerNow(roomId, playerId, options);
        removePendingRoomCleanup(roomId, playerId);
      })
      .catch((error) => {
        queuePendingRoomCleanup({ roomId, playerId, preservePlayingSeatAsAi: options.preservePlayingSeatAsAi ?? true });
        console.warn('방 전환 후 이전 방 정리에 실패했습니다.', error);
      });
  }, TRANSITION_REMOVAL_DELAY_MS);
  transitionRemovalTimers.set(key, timerId);
}

export async function removeRoomPlayerSafely(...args: Parameters<typeof removeRoomPlayerCore>) {
  const [roomId, playerId, options = {}] = args;
  const pendingCleanup = { roomId, playerId, preservePlayingSeatAsAi: options.preservePlayingSeatAsAi ?? true };
  if (!isGameScreenActive() && shouldDeferOwnRoomRemoval({
    roomId,
    activeRoomId: getActiveRoomIdFromStorage(),
    currentUserId: auth?.currentUser?.uid ?? '',
    playerId,
  })) {
    queuePendingRoomCleanup(pendingCleanup);
    scheduleTransitionRoomRemoval(roomId, playerId, options);
    return;
  }
  queuePendingRoomCleanup(pendingCleanup);
  try {
    await removeRoomPlayerNow(roomId, playerId, options);
    removePendingRoomCleanup(roomId, playerId);
  } catch (error) {
    throw error;
  }
}

export async function leaveDuplicatePlayerRoomsSafely(playerId: string, keepRoomId = '') {
  const memberships = await getActivePlayerRoomMemberships(playerId);
  if (memberships.length < 2 && !keepRoomId) return [];
  const sortedMemberships = [...memberships].sort((left, right) => right.joinedAt - left.joinedAt);
  const selectedKeepRoomId = keepRoomId || sortedMemberships[0]?.room.id || '';
  const roomsToLeave = memberships.filter((membership) => membership.room.id !== selectedKeepRoomId);
  await Promise.all(roomsToLeave.map(({ room }) => removeRoomPlayerNow(room.id, playerId)));
  return roomsToLeave.map(({ room }) => room.id);
}

export async function drainPendingRoomCleanups() {
  if (pendingCleanupDrainInFlight) return;
  const entries = readPendingCleanups();
  if (!entries.length) return;
  pendingCleanupDrainInFlight = true;
  const failed: PendingRoomCleanup[] = [];
  try {
    for (const entry of entries) {
      if (entry.roomId === getActiveRoomIdFromStorage()) {
        failed.push(entry);
        continue;
      }
      try {
        await removeRoomPlayerNow(entry.roomId, entry.playerId, { preservePlayingSeatAsAi: entry.preservePlayingSeatAsAi });
      } catch {
        failed.push(entry);
      }
    }
    writePendingCleanups(failed);
  } finally {
    pendingCleanupDrainInFlight = false;
  }
}
