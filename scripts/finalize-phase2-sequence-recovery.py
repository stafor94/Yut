from pathlib import Path

path = Path('src/app/App.tsx')
source = path.read_text()


def replace_once(old: str, new: str, label: str) -> None:
    global source
    count = source.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected 1 match, found {count}')
    source = source.replace(old, new, 1)


replace_once(
    "  const turnRecoveryInFlightRef = useRef(false);",
    "  const turnRecoveryInFlightRef = useRef<{ roomId: string; token: string } | null>(null);",
    'room-scoped recovery ref',
)

replace_once(
    """    if (turnRecoveryInFlightRef.current || timeoutRecoveryKeysRef.current.has(recoveryKey)) return false;
    turnRecoveryInFlightRef.current = true;
    timeoutRecoveryKeysRef.current.add(recoveryKey);""",
    """    const recoveryToken = `${activeRoomId}:roll:${recoveryKey}`;
    if (turnRecoveryInFlightRef.current?.roomId === activeRoomId || timeoutRecoveryKeysRef.current.has(recoveryKey)) return false;
    turnRecoveryInFlightRef.current = { roomId: activeRoomId, token: recoveryToken };
    timeoutRecoveryKeysRef.current.add(recoveryKey);""",
    'roll recovery token start',
)

replace_once(
    """    if (turnRecoveryInFlightRef.current || stalledTurnRecoveryKeyRef.current === recoveryKey) return false;
    if (winner || rollResultHolding || rollAnimation || movingPieceId || moveInProgress || pendingTrapPlacement) return false;
    if (stalledTurnNeedsBranchChoice || stalledTurnRollStackAmbiguous) return false;

    turnRecoveryInFlightRef.current = true;
    stalledTurnRecoveryKeyRef.current = recoveryKey;""",
    """    const recoveryToken = `${activeRoomId}:move:${recoveryKey}`;
    if (turnRecoveryInFlightRef.current?.roomId === activeRoomId || stalledTurnRecoveryKeyRef.current === recoveryKey) return false;
    if (winner || rollResultHolding || rollAnimation || movingPieceId || moveInProgress || pendingTrapPlacement) return false;
    if (stalledTurnNeedsBranchChoice || stalledTurnRollStackAmbiguous) return false;

    turnRecoveryInFlightRef.current = { roomId: activeRoomId, token: recoveryToken };
    stalledTurnRecoveryKeyRef.current = recoveryKey;""",
    'move recovery token start',
)

old_finally = "      () => { turnRecoveryInFlightRef.current = false; },"
new_finally = "      () => { if (turnRecoveryInFlightRef.current?.token === recoveryToken) turnRecoveryInFlightRef.current = null; },"
if source.count(old_finally) != 2:
    raise SystemExit(f'recovery token finish: expected 2 matches, found {source.count(old_finally)}')
source = source.replace(old_finally, new_finally)

replace_once(
    "      turnRecoveryInFlight: turnRecoveryInFlightRef.current,",
    "      turnRecoveryInFlight: turnRecoveryInFlightRef.current?.roomId === roomId,",
    'room-scoped recovery conflict',
)

replace_once(
    """      const latestSequence = Math.max(localSequence, ...orderedSequences.map((sequence) => Number(sequence.sequence ?? 0)));
      const latestState = [...orderedSequences].reverse().find((sequence) => sequence.stateAfter)?.stateAfter as SequenceStateSnapshot | undefined;
      if (latestSequence <= localSequence || !latestState) return 'unchanged';
      await replayMissingSequencesThenApply(latestState, localSequence, latestSequence);""",
    """      const latestSequence = Math.max(localSequence, ...orderedSequences.map((sequence) => Number(sequence.sequence ?? 0)));
      const latestState = [...orderedSequences].reverse().find((sequence) => sequence.stateAfter)?.stateAfter as SequenceStateSnapshot | undefined;
      const currentLocalSequence = lastAppliedSequenceRef.current;
      if (latestSequence <= currentLocalSequence || !latestState) return 'unchanged';
      await replayMissingSequencesThenApply(latestState, currentLocalSequence, latestSequence);""",
    'response-time local sequence',
)

path.write_text(source)
