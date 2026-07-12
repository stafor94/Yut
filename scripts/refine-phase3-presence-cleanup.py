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
    "import { decideRoomPresenceCleanupLease, getRoomPresenceCleanupAction, ROOM_PRESENCE_CLEANUP_LEASE_MS, ROOM_PRESENCE_STALE_MS } from './roomPresenceCleanupPolicy';",
    "import { decideRoomPresenceCleanupLease, getRoomPresenceCleanupAction, isStaleHumanPresencePlayer, ROOM_PRESENCE_CLEANUP_LEASE_MS, ROOM_PRESENCE_STALE_MS } from './roomPresenceCleanupPolicy';",
    'stale policy import',
)
replace_once(
    room_service,
    """  const cleanupCandidates = playersSnapshot.docs
    .map((playerSnapshot) => ({
      id: playerSnapshot.id,
      action: getRoomPresenceCleanupAction(
        { ...(playersSnapshot.metadata.hasPendingWrites ? {} : {}), status: 'waiting' },
        { id: playerSnapshot.id, ...(playerSnapshot.data() as Omit<RoomPlayer, 'id'>) },
        requestedAt,
        staleMs,
      ),
    }))
    .filter((candidate) => candidate.action !== 'skip');""",
    """  const cleanupCandidates = playersSnapshot.docs
    .map((playerSnapshot) => ({ id: playerSnapshot.id, ...(playerSnapshot.data() as Omit<RoomPlayer, 'id'>) }))
    .filter((player) => isStaleHumanPresencePlayer(player, requestedAt, staleMs));""",
    'stale candidate filter',
)

app = Path('src/app/App.tsx')
replace_once(
    app,
    "  const [spectators, setSpectators] = useState<Seat[]>([]);\n  const [pendingItemPickup, setPendingItemPickup] = useState<PendingItemPickup | null>(null);",
    "  const [spectators, setSpectators] = useState<Seat[]>([]);\n  const [presenceCleanupEligibility, setPresenceCleanupEligibility] = useState({ roomId: '', eligible: false });\n  const [pendingItemPickup, setPendingItemPickup] = useState<PendingItemPickup | null>(null);",
    'presence eligibility state',
)
replace_once(
    app,
    "  const canOwnRoomPresenceCleanup = Boolean(activeRoomId && localSeatId && !isSpectator && playableSeats.some((seat) => seat.id === localSeatId && !seat.isAI));",
    "  const canOwnRoomPresenceCleanup = Boolean(activeRoomId && presenceCleanupEligibility.roomId === activeRoomId && presenceCleanupEligibility.eligible);",
    'snapshot-backed cleanup eligibility',
)
replace_once(
    app,
    """      const hasCurrentUserInSnapshot = Boolean(currentUserId && players.some((player) => player.id === currentUserId && !player.isSpectator));
      if (hasCurrentUserInSnapshot) confirmedRoomPlayerRef.current = true;""",
    """      const localPresencePlayer = currentUserId ? players.find((player) => player.id === currentUserId) : undefined;
      const hasCurrentUserInSnapshot = Boolean(localPresencePlayer && !localPresencePlayer.isSpectator);
      setPresenceCleanupEligibility({
        roomId: activeRoomId,
        eligible: Boolean(localPresencePlayer && !localPresencePlayer.isAI && !localPresencePlayer.isSpectator),
      });
      if (hasCurrentUserInSnapshot) confirmedRoomPlayerRef.current = true;""",
    'snapshot eligibility update',
)
replace_once(
    app,
    "      const substitutedLocalPlayer = currentUserId ? players.find((player) => player.id === currentUserId && player.isAI && player.isSubstitutedByAI && !player.isSpectator) : undefined;",
    "      const substitutedLocalPlayer = localPresencePlayer && localPresencePlayer.isAI && localPresencePlayer.isSubstitutedByAI && !localPresencePlayer.isSpectator ? localPresencePlayer : undefined;",
    'reuse local presence player',
)

print('phase 3 refinement applied')
