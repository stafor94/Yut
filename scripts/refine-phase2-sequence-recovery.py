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
    "import { createSequenceRecoveryWatchdog, type SequenceRecoveryCheckResult, type SequenceRecoveryWatchdogController } from './hooks/sequenceRecoveryWatchdog';",
    "import { createSequenceRecoveryWatchdog, shouldDeferSequenceRecovery, type SequenceRecoveryCheckResult, type SequenceRecoveryWatchdogController } from './hooks/sequenceRecoveryWatchdog';",
    'conflict helper import',
)

replace_once(
    """    if (
      sequenceReplayInProgressRef.current
      || moveInProgressRef.current
      || applyingSyncedStateRef.current
      || manualSequenceSyncing
      || pendingLocalRemoteActionsRef.current.size > 0
      || turnRecoveryInFlightRef.current
    ) return 'deferred';""",
    """    if (shouldDeferSequenceRecovery({
      sequenceReplayInProgress: sequenceReplayInProgressRef.current,
      moveInProgress: moveInProgressRef.current,
      applyingSyncedState: applyingSyncedStateRef.current,
      manualSequenceSyncing,
      hasPendingRemoteActions: pendingLocalRemoteActionsRef.current.size > 0,
      turnRecoveryInFlight: turnRecoveryInFlightRef.current,
    })) return 'deferred';""",
    'conflict helper use',
)

replace_once(
    "void handleAuthoritativeActionRejected('roll_yut', 'turn-roll-timeout-recovery-result', result, {",
    "await handleAuthoritativeActionRejected('roll_yut', 'turn-roll-timeout-recovery-result', result, {",
    'roll rejection await',
)

replace_once(
    "void handleAuthoritativeActionRejected('move_piece', 'stalled-turn-recovery-result', result, {",
    "await handleAuthoritativeActionRejected('move_piece', 'stalled-turn-recovery-result', result, {",
    'move rejection await',
)

path.write_text(source)
