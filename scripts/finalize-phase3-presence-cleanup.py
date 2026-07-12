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
    "import { decideRoomPresenceCleanupLease, getRoomPresenceCleanupAction, isStaleHumanPresencePlayer, ROOM_PRESENCE_CLEANUP_LEASE_MS, ROOM_PRESENCE_STALE_MS } from './roomPresenceCleanupPolicy';",
    "import { decideRoomPresenceCleanupLease, getRoomPresenceCleanupAction, isEligiblePresenceCleanupCandidate, isStaleHumanPresencePlayer, ROOM_PRESENCE_CLEANUP_LEASE_MS, ROOM_PRESENCE_STALE_MS } from './roomPresenceCleanupPolicy';",
    'cleanup candidate policy import',
)
replace_once(
    room_service,
    """  const roomRef = doc(db, 'rooms', roomId);
  const leaseDecision = await runTransaction(db, async (transaction) => {
    const roomSnapshot = await transaction.get(roomRef);
    if (!roomSnapshot.exists()) return { status: 'inactive' as const, ownerId: '', expiresAt: 0 };
    const room = roomSnapshot.data() as Omit<RoomSummary, 'id'>;
    const decision = decideRoomPresenceCleanupLease(room, candidatePlayerId, requestedAt, leaseMs);""",
    """  const roomRef = doc(db, 'rooms', roomId);
  const candidateRef = doc(db, 'rooms', roomId, 'players', candidatePlayerId);
  const leaseDecision = await runTransaction(db, async (transaction) => {
    const roomSnapshot = await transaction.get(roomRef);
    if (!roomSnapshot.exists()) return { status: 'inactive' as const, ownerId: '', expiresAt: 0 };
    const candidateSnapshot = await transaction.get(candidateRef);
    const room = roomSnapshot.data() as Omit<RoomSummary, 'id'>;
    const currentOwnerId = room.presenceCleanupLeaseOwnerId ?? '';
    const currentExpiresAt = Number(room.presenceCleanupLeaseExpiresAt ?? 0);
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
      return { status: 'inactive' as const, ownerId: currentOwnerId, expiresAt: currentExpiresAt };
    }
    const decision = decideRoomPresenceCleanupLease(room, candidatePlayerId, requestedAt, leaseMs);""",
    'transactional candidate validation',
)

app = Path('src/app/App.tsx')
replace_once(
    app,
    """      setPresenceCleanupEligibility({
        roomId: activeRoomId,
        eligible: Boolean(localPresencePlayer && !localPresencePlayer.isAI && !localPresencePlayer.isSpectator),
      });""",
    """      const nextPresenceCleanupEligible = Boolean(localPresencePlayer && !localPresencePlayer.isAI && !localPresencePlayer.isSpectator);
      setPresenceCleanupEligibility((current) => current.roomId === activeRoomId && current.eligible === nextPresenceCleanupEligible
        ? current
        : { roomId: activeRoomId, eligible: nextPresenceCleanupEligible });""",
    'stable cleanup eligibility state',
)

print('phase 3 finalization applied')
