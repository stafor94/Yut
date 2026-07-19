import { collection, doc, getDocs, runTransaction, serverTimestamp } from 'firebase/firestore';
import { db } from '../../../services/firebase/firebaseDb';
import {
  type CurrentRoomPresenceCleanupResult,
  type RoomPlayer,
  type RoomSeat,
  type RoomSummary,
  type SyncedGameState,
} from './roomServiceCore';
import {
  decideRoomPresenceCleanupLease,
  getRoomPresenceCleanupAction,
  isEligiblePresenceCleanupCandidate,
  isStaleHumanPresencePlayer,
  ROOM_PRESENCE_CLEANUP_LEASE_MS,
  ROOM_PRESENCE_STALE_MS,
} from './roomPresenceCleanupPolicy';
import { updateGameSeatControlState } from './roomPresenceGameSeat';

export async function cleanupCurrentRoomPresenceSafely(
  roomId: string,
  candidatePlayerId: string,
  options: { now?: number; staleMs?: number; leaseMs?: number } = {},
): Promise<CurrentRoomPresenceCleanupResult> {
  if (!db || !roomId || !candidatePlayerId) return { status: 'unavailable', ownerId: '', expiresAt: 0, cleanedPlayerIds: [] };
  const requestedAt = options.now ?? Date.now();
  const staleMs = options.staleMs ?? ROOM_PRESENCE_STALE_MS;
  const leaseMs = options.leaseMs ?? ROOM_PRESENCE_CLEANUP_LEASE_MS;
  const roomRef = doc(db, 'rooms', roomId);
  const candidateRef = doc(db, 'rooms', roomId, 'players', candidatePlayerId);
  const gameStateRef = doc(db, 'rooms', roomId, 'state', 'current');

  const leaseDecision = await runTransaction(db, async (transaction) => {
    const roomSnapshot = await transaction.get(roomRef);
    if (!roomSnapshot.exists()) return { status: 'inactive' as const, ownerId: '', expiresAt: 0, version: 0 };
    const candidateSnapshot = await transaction.get(candidateRef);
    const room = roomSnapshot.data() as Omit<RoomSummary, 'id'>;
    const currentOwnerId = room.presenceCleanupLeaseOwnerId ?? '';
    const currentExpiresAt = Number(room.presenceCleanupLeaseExpiresAt ?? 0);
    const currentVersion = Number(room.presenceCleanupLeaseVersion ?? 0);
    const candidate = candidateSnapshot.exists()
      ? { id: candidateSnapshot.id, ...(candidateSnapshot.data() as Omit<RoomPlayer, 'id'>) }
      : null;
    if (!isEligiblePresenceCleanupCandidate(candidate)) {
      if (currentOwnerId === candidatePlayerId) {
        transaction.set(roomRef, {
          presenceCleanupLeaseOwnerId: '',
          presenceCleanupLeaseExpiresAt: 0,
          presenceCleanupLeaseUpdatedAt: serverTimestamp(),
        }, { merge: true });
      }
      return { status: 'inactive' as const, ownerId: currentOwnerId, expiresAt: currentExpiresAt, version: currentVersion };
    }
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
    .map((playerSnapshot) => ({ id: playerSnapshot.id, ...(playerSnapshot.data() as Omit<RoomPlayer, 'id'>) }))
    .filter((player) => isStaleHumanPresencePlayer(player, requestedAt, staleMs));

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
    const hasSeat = !player.isSpectator && Number.isInteger(seatIndex) && seatIndex >= 0;
    if (action === 'substitute_ai' && hasSeat) {
      const seatRef = doc(db!, 'rooms', roomId, 'seats', String(seatIndex));
      const [seatSnapshot, gameStateSnapshot] = await Promise.all([
        transaction.get(seatRef),
        transaction.get(gameStateRef),
      ]);
      const seat = seatSnapshot.exists() ? seatSnapshot.data() as RoomSeat : null;
      const gameState = gameStateSnapshot.exists() ? gameStateSnapshot.data() as SyncedGameState : null;
      const nextPresenceEpoch = Math.max(Number(player.presenceEpoch ?? 0), Number(seat?.presenceEpoch ?? 0)) + 1;
      transaction.set(playerRef, {
        nickname: player.nickname || '플레이어',
        ready: true,
        isAI: true,
        isSubstitutedByAI: true,
        isSpectator: false,
        presenceEpoch: nextPresenceEpoch,
        substitutedAt: serverTimestamp(),
        lastSeen: serverTimestamp(),
      }, { merge: true });
      transaction.set(seatRef, {
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
        presenceEpoch: nextPresenceEpoch,
        substitutedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }, { merge: true });
      if (gameState) {
        const nextGameSeats = updateGameSeatControlState(gameState.gameSeats, {
          playerId: player.id,
          seatIndex,
          isAI: true,
          isSubstitutedByAI: true,
          presenceEpoch: nextPresenceEpoch,
        });
        if (nextGameSeats) transaction.set(gameStateRef, { gameSeats: nextGameSeats, updatedAt: serverTimestamp() }, { merge: true });
      }
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

  return {
    status: leaseDecision.status === 'renew' ? 'renewed' : 'acquired',
    ownerId: candidatePlayerId,
    expiresAt: leaseDecision.expiresAt,
    cleanedPlayerIds: cleanedResults.filter((playerId): playerId is string => Boolean(playerId)),
  };
}
