from pathlib import Path


def replace_once(path: Path, old: str, new: str, label: str) -> None:
    source = path.read_text()
    count = source.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected 1 match, found {count}')
    path.write_text(source.replace(old, new, 1))


room_service = Path('src/features/room/services/roomService.ts')
replace_once(
    room_service,
    "import { TURN_NETWORK_GRACE_MS } from './roomTiming';",
    "import { TURN_NETWORK_GRACE_MS } from './roomTiming';\nimport { decideRoomPresenceCleanupLease, getRoomPresenceCleanupAction, ROOM_PRESENCE_CLEANUP_LEASE_MS, ROOM_PRESENCE_STALE_MS } from './roomPresenceCleanupPolicy';",
    'room presence policy import',
)
replace_once(
    room_service,
    "  id: string; title: string; hostId?: string; status: 'waiting' | 'playing' | 'finished'; maxPlayers: number; itemMode: boolean; stackedRollMode?: boolean; playMode: 'individual' | 'team'; pieceCount: 1 | 2 | 3 | 4; createdAt?: unknown; emptySince?: number | null; currentPlayers?: number; playerIds?: string[]; startCountdownUntil?: number; startRequestVersion?: number; startRequestedAt?: number; startCountdownStartsAt?: number; startCountdownEndsAt?: number; startCancelledAt?: number | null; startStatus?: 'idle' | 'requested' | 'cancelled' | 'entering' | 'playing'; startRequestId?: string; roomConfigVersion?: number;",
    "  id: string; title: string; hostId?: string; status: 'waiting' | 'playing' | 'finished'; maxPlayers: number; itemMode: boolean; stackedRollMode?: boolean; playMode: 'individual' | 'team'; pieceCount: 1 | 2 | 3 | 4; createdAt?: unknown; emptySince?: number | null; currentPlayers?: number; playerIds?: string[]; startCountdownUntil?: number; startRequestVersion?: number; startRequestedAt?: number; startCountdownStartsAt?: number; startCountdownEndsAt?: number; startCancelledAt?: number | null; startStatus?: 'idle' | 'requested' | 'cancelled' | 'entering' | 'playing'; startRequestId?: string; roomConfigVersion?: number; presenceCleanupLeaseOwnerId?: string; presenceCleanupLeaseExpiresAt?: number; presenceCleanupLeaseVersion?: number; presenceCleanupLeaseUpdatedAt?: unknown;",
    'room summary lease fields',
)
replace_once(
    room_service,
    "const STALE_PLAYER_DELETE_MS = 45000;\n",
    "",
    'remove stale constant',
)
old_presence = """export async function heartbeatRoomPlayer(roomId: string, playerId: string) {
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
"""
new_presence = """export async function heartbeatRoomPlayer(roomId: string, playerId: string) {
  if (!db || !roomId || !playerId) return false;
  try {
    await updateDoc(doc(db, 'rooms', roomId, 'players', playerId), { lastSeen: serverTimestamp() });
    return true;
  } catch {
    return false;
  }
}

export type CurrentRoomPresenceCleanupResult = {
  status: 'unavailable' | 'inactive' | 'held' | 'acquired' | 'renewed';
  ownerId: string;
  expiresAt: number;
  cleanedPlayerIds: string[];
};

export async function cleanupCurrentRoomPresence(
  roomId: string,
  candidatePlayerId: string,
  options: { now?: number; staleMs?: number; leaseMs?: number } = {},
): Promise<CurrentRoomPresenceCleanupResult> {
  if (!db || !roomId || !candidatePlayerId) return { status: 'unavailable', ownerId: '', expiresAt: 0, cleanedPlayerIds: [] };
  const requestedAt = options.now ?? Date.now();
  const staleMs = options.staleMs ?? ROOM_PRESENCE_STALE_MS;
  const leaseMs = options.leaseMs ?? ROOM_PRESENCE_CLEANUP_LEASE_MS;
  const roomRef = doc(db, 'rooms', roomId);
  const leaseDecision = await runTransaction(db, async (transaction) => {
    const roomSnapshot = await transaction.get(roomRef);
    if (!roomSnapshot.exists()) return { status: 'inactive' as const, ownerId: '', expiresAt: 0 };
    const room = roomSnapshot.data() as Omit<RoomSummary, 'id'>;
    const decision = decideRoomPresenceCleanupLease(room, candidatePlayerId, requestedAt, leaseMs);
    if (decision.status === 'acquire' || decision.status === 'renew') {
      transaction.set(roomRef, {
        presenceCleanupLeaseOwnerId: decision.ownerId,
        presenceCleanupLeaseExpiresAt: decision.expiresAt,
        presenceCleanupLeaseVersion: decision.version,
        presenceCleanupLeaseUpdatedAt: serverTimestamp(),
      }, { merge: true });
    }
    return decision;
  });
  if (leaseDecision.status === 'inactive') return { status: 'inactive', ownerId: leaseDecision.ownerId, expiresAt: leaseDecision.expiresAt, cleanedPlayerIds: [] };
  if (leaseDecision.status === 'held') return { status: 'held', ownerId: leaseDecision.ownerId, expiresAt: leaseDecision.expiresAt, cleanedPlayerIds: [] };

  const playersSnapshot = await getDocs(collection(db, 'rooms', roomId, 'players'));
  const cleanupCandidates = playersSnapshot.docs
    .map((playerSnapshot) => ({
      id: playerSnapshot.id,
      action: getRoomPresenceCleanupAction(
        { ...(playersSnapshot.metadata.hasPendingWrites ? {} : {}), status: 'waiting' },
        { id: playerSnapshot.id, ...(playerSnapshot.data() as Omit<RoomPlayer, 'id'>) },
        requestedAt,
        staleMs,
      ),
    }))
    .filter((candidate) => candidate.action !== 'skip');

  const cleanedResults = await Promise.all(cleanupCandidates.map(async (candidate) => runTransaction(db!, async (transaction) => {
    const cleanupRoomSnapshot = await transaction.get(roomRef);
    if (!cleanupRoomSnapshot.exists()) return null;
    const room = cleanupRoomSnapshot.data() as Omit<RoomSummary, 'id'>;
    const leaseOwnerId = room.presenceCleanupLeaseOwnerId ?? '';
    const leaseExpiresAt = Number(room.presenceCleanupLeaseExpiresAt ?? 0);
    if (leaseOwnerId !== candidatePlayerId || leaseExpiresAt <= Date.now()) return null;

    const playerRef = doc(db!, 'rooms', roomId, 'players', candidate.id);
    const playerSnapshot = await transaction.get(playerRef);
    if (!playerSnapshot.exists()) return null;
    const player = { id: playerSnapshot.id, ...(playerSnapshot.data() as Omit<RoomPlayer, 'id'>) };
    const action = getRoomPresenceCleanupAction(room, player, Date.now(), staleMs);
    if (action === 'skip') return null;

    const seatIndex = Number(player.seatIndex);
    const hasSeat = Number.isInteger(seatIndex) && seatIndex >= 0;
    if (action === 'substitute_ai' && hasSeat) {
      transaction.set(playerRef, {
        nickname: player.nickname || '플레이어',
        ready: true,
        isAI: true,
        isSubstitutedByAI: true,
        isSpectator: false,
        lastSeen: serverTimestamp(),
      }, { merge: true });
      transaction.set(doc(db!, 'rooms', roomId, 'seats', String(seatIndex)), {
        playerId: player.id,
        originalPlayerId: player.id,
        currentPlayerId: player.id,
        nickname: player.nickname,
        color: player.color,
        team: player.team,
        seatIndex,
        label: `P${seatIndex + 1}`,
        aiActive: true,
        aiName: '',
        isSubstitutedByAI: true,
        status: 'ai_substitute',
        updatedAt: serverTimestamp(),
      }, { merge: true });
      return player.id;
    }

    transaction.delete(playerRef);
    if (hasSeat) {
      transaction.set(doc(db!, 'rooms', roomId, 'seats', String(seatIndex)), {
        playerId: player.id,
        originalPlayerId: player.id,
        currentPlayerId: player.id,
        nickname: player.nickname,
        color: player.color,
        team: player.team,
        seatIndex,
        label: `P${seatIndex + 1}`,
        aiActive: false,
        isSubstitutedByAI: false,
        status: 'disconnected',
        updatedAt: serverTimestamp(),
      }, { merge: true });
    }
    return player.id;
  })));
  const cleanedPlayerIds = cleanedResults.filter((playerId): playerId is string => Boolean(playerId));
  if (cleanedPlayerIds.length) await syncRoomPlayerCount(roomId);
  return {
    status: leaseDecision.status === 'renew' ? 'renewed' : 'acquired',
    ownerId: candidatePlayerId,
    expiresAt: leaseDecision.expiresAt,
    cleanedPlayerIds,
  };
}

export async function releaseRoomPresenceCleanupLease(roomId: string, candidatePlayerId: string) {
  if (!db || !roomId || !candidatePlayerId) return false;
  const roomRef = doc(db, 'rooms', roomId);
  return runTransaction(db, async (transaction) => {
    const roomSnapshot = await transaction.get(roomRef);
    if (!roomSnapshot.exists()) return false;
    const room = roomSnapshot.data() as Omit<RoomSummary, 'id'>;
    if (room.presenceCleanupLeaseOwnerId !== candidatePlayerId) return false;
    transaction.set(roomRef, {
      presenceCleanupLeaseOwnerId: '',
      presenceCleanupLeaseExpiresAt: 0,
      presenceCleanupLeaseUpdatedAt: serverTimestamp(),
    }, { merge: true });
    return true;
  });
}
"""
replace_once(room_service, old_presence, new_presence, 'replace global stale cleanup')

presence_hook = Path('src/app/hooks/useRoomPresence.ts')
presence_hook.write_text("""import { useEffect } from 'react';
import {
  cleanupCurrentRoomPresence,
  heartbeatRoomPlayer,
  releaseRoomPresenceCleanupLease,
} from '../../features/room/services/roomService';
import {
  ROOM_PRESENCE_CLEANUP_INTERVAL_MS,
} from '../../features/room/services/roomPresenceCleanupPolicy';

export function useRoomPresence(activeRoomId: string, localSeatId: string, options: { canCleanup?: boolean } = {}) {
  const canCleanup = Boolean(options.canCleanup);

  useEffect(() => {
    if (!activeRoomId || !localSeatId) return undefined;
    let disposed = false;
    let cycleInFlight = false;

    const runPresenceCycle = async () => {
      if (disposed || cycleInFlight) return;
      cycleInFlight = true;
      try {
        const heartbeatSucceeded = await heartbeatRoomPlayer(activeRoomId, localSeatId);
        if (!disposed && heartbeatSucceeded && canCleanup) {
          await cleanupCurrentRoomPresence(activeRoomId, localSeatId);
        }
      } catch {
        // 다음 presence 주기에 다시 시도한다.
      } finally {
        cycleInFlight = false;
      }
    };

    const handleResume = () => { void runPresenceCycle(); };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') void runPresenceCycle();
    };

    void runPresenceCycle();
    const presenceTimer = window.setInterval(() => { void runPresenceCycle(); }, ROOM_PRESENCE_CLEANUP_INTERVAL_MS);
    window.addEventListener('focus', handleResume);
    window.addEventListener('pageshow', handleResume);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      disposed = true;
      window.clearInterval(presenceTimer);
      window.removeEventListener('focus', handleResume);
      window.removeEventListener('pageshow', handleResume);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (canCleanup) void releaseRoomPresenceCleanupLease(activeRoomId, localSeatId);
    };
  }, [activeRoomId, canCleanup, localSeatId]);
}
""")

app = Path('src/app/App.tsx')
replace_once(
    app,
    "  const roomHostClaimKeyRef = useRef('');\n  const pendingAiSeatIdsRef = useRef<Set<string>>(new Set());",
    "  const roomHostClaimKeyRef = useRef('');\n  const presenceRestoreKeyRef = useRef('');\n  const pendingAiSeatIdsRef = useRef<Set<string>>(new Set());",
    'presence restore ref',
)
replace_once(
    app,
    "  const canCoordinateOnlineGame = !activeRoomId || Boolean(isOnlinePlayer && localSeatId && localSeatId === onlineGameCoordinatorSeatId);\n  const canResolveInitialOnlineTurnOrder = canCoordinateOnlineGame;",
    "  const canCoordinateOnlineGame = !activeRoomId || Boolean(isOnlinePlayer && localSeatId && localSeatId === onlineGameCoordinatorSeatId);\n  const canOwnRoomPresenceCleanup = Boolean(activeRoomId && localSeatId && !isSpectator && playableSeats.some((seat) => seat.id === localSeatId && !seat.isAI));\n  const canResolveInitialOnlineTurnOrder = canCoordinateOnlineGame;",
    'presence cleanup candidate',
)
replace_once(
    app,
    "  useRoomPresence(activeRoomId, localSeatId);",
    "  useRoomPresence(activeRoomId, localSeatId, { canCleanup: canOwnRoomPresenceCleanup });",
    'presence hook call',
)
replace_once(
    app,
    """      const currentHostPlayer = activeRoomHostId ? players.find((player) => player.id === activeRoomHostId) : undefined;
      const hasActiveHumanHost = Boolean(currentHostPlayer && !currentHostPlayer.isAI && !currentHostPlayer.isSpectator);
      const localHumanPlayer = currentUserId ? players.find((player) => player.id === currentUserId && !player.isAI && !player.isSpectator) : undefined;""",
    """      const substitutedLocalPlayer = currentUserId ? players.find((player) => player.id === currentUserId && player.isAI && player.isSubstitutedByAI && !player.isSpectator) : undefined;
      if (substitutedLocalPlayer && activeRoomId && screen === 'game' && !leavingRoomRef.current) {
        const restoreKey = `${activeRoomId}:${currentUserId}:${substitutedLocalPlayer.seatIndex}`;
        if (presenceRestoreKeyRef.current !== restoreKey) {
          presenceRestoreKeyRef.current = restoreKey;
          void joinRoom(activeRoomId, { userId: currentUserId!, nickname: substitutedLocalPlayer.nickname || nickname, playMode })
            .then((result) => {
              if (result.role !== 'player') {
                presenceRestoreKeyRef.current = '';
                return;
              }
              setMessage('연결이 복구되어 원래 좌석으로 다시 참여했습니다.');
            })
            .catch(() => { presenceRestoreKeyRef.current = ''; });
        }
      } else if (!substitutedLocalPlayer) {
        presenceRestoreKeyRef.current = '';
      }
      const currentHostPlayer = activeRoomHostId ? players.find((player) => player.id === activeRoomHostId) : undefined;
      const hasActiveHumanHost = Boolean(currentHostPlayer && !currentHostPlayer.isAI && !currentHostPlayer.isSpectator);
      const localHumanPlayer = currentUserId ? players.find((player) => player.id === currentUserId && !player.isAI && !player.isSpectator) : undefined;""",
    'automatic substituted player restore',
)

print('phase 3 presence cleanup patch applied')
