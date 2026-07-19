interface LocalRoomPlayerSnapshot { id: string; isAI?: boolean; isSpectator?: boolean }

export function shouldIgnoreRoomPlayersSnapshot(activeRoomId: string, currentRoomId: string) {
  return !activeRoomId || currentRoomId !== activeRoomId;
}

export function resolveLocalRoomPlayerSnapshot<TPlayer extends LocalRoomPlayerSnapshot>(players: TPlayer[], currentUserId: string) {
  const localPresencePlayer = currentUserId ? players.find((player) => player.id === currentUserId) : undefined;
  return {
    localPresencePlayer,
    hasCurrentUserInSnapshot: Boolean(localPresencePlayer && !localPresencePlayer.isSpectator),
    presenceCleanupEligible: Boolean(localPresencePlayer && !localPresencePlayer.isAI),
  };
}

export function makeRoomHostClaimKey(roomId: string, hostId: string, candidateUserId: string) {
  return `${roomId}:${hostId || 'missing'}:${candidateUserId}`;
}
