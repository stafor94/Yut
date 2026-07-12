from pathlib import Path

app_path = Path('src/app/App.tsx')
source = app_path.read_text()


def replace_once(old: str, new: str, label: str) -> None:
    global source
    count = source.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected 1 match, found {count}')
    source = source.replace(old, new, 1)


replace_once(
    "import { useGameSyncDebugState, useGameSyncSubscription } from './hooks/useGameSync';",
    "import { useGameSyncDebugState, useGameSyncSubscription } from './hooks/useGameSync';\nimport { createSequenceRecoveryWatchdog, type SequenceRecoveryCheckResult, type SequenceRecoveryWatchdogController } from './hooks/sequenceRecoveryWatchdog';",
    'watchdog import',
)

replace_once(
    'const SEQUENCE_WATCHDOG_MS = 5000;',
    "const SEQUENCE_RECOVERY_INITIAL_DELAY_MS = 5000;\nconst SEQUENCE_RECOVERY_RETRY_DELAYS_MS = [5000, 10000, 20000] as const;\nconst SEQUENCE_RECOVERY_MAX_ATTEMPTS = 4;\nconst SEQUENCE_RECOVERY_MAX_TOTAL_MS = 40000;",
    'watchdog constants',
)

replace_once(
    "  const lastSequenceWatchdogAtRef = useRef(0);\n  const stalledTurnWatchKeyRef = useRef('');",
    """  const lastSequenceWatchdogAtRef = useRef(0);
  const sequenceRecoveryCheckRef = useRef<() => Promise<SequenceRecoveryCheckResult>>(async () => 'deferred');
  const sequenceRecoveryWatchdogRef = useRef<SequenceRecoveryWatchdogController | null>(null);
  if (!sequenceRecoveryWatchdogRef.current) {
    sequenceRecoveryWatchdogRef.current = createSequenceRecoveryWatchdog({
      runCheck: () => sequenceRecoveryCheckRef.current(),
      scheduler: {
        now: () => Date.now(),
        setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs),
        clearTimeout: (timerId) => window.clearTimeout(timerId),
      },
      initialDelayMs: SEQUENCE_RECOVERY_INITIAL_DELAY_MS,
      retryDelaysMs: SEQUENCE_RECOVERY_RETRY_DELAYS_MS,
      maxAttempts: SEQUENCE_RECOVERY_MAX_ATTEMPTS,
      maxTotalMs: SEQUENCE_RECOVERY_MAX_TOTAL_MS,
      onCheckStarted: () => { lastSequenceWatchdogAtRef.current = Date.now(); },
    });
  }
  const turnRecoveryInFlightRef = useRef(false);
  const stalledTurnWatchKeyRef = useRef('');""",
    'watchdog refs',
)

replace_once(
    "    lastAppliedStateVersionRef.current = 0;\n    lastAppliedSequenceRef.current = 0;\n    setAuthoritativeGameStateReady(false);",
    "    lastAppliedStateVersionRef.current = 0;\n    lastAppliedSequenceRef.current = 0;\n    lastSequenceWatchdogAtRef.current = 0;\n    setAuthoritativeGameStateReady(false);",
    'room reset',
)

replace_once(
    """  async function recoverTimedOutRoll(recoveryKey: string, options: { source?: string } = {}) {
    if (!canSubmitDeadlineRecovery() || onlineAuthoritativeGameStatePending || !activeRoomId || !activeSeat || roll || rollInProgress || rollAnimation || movingPieceId || moveInProgress) return false;
    if (timeoutRecoveryKeysRef.current.has(recoveryKey)) return false;
    timeoutRecoveryKeysRef.current.add(recoveryKey);""",
    """  async function recoverTimedOutRoll(recoveryKey: string, options: { source?: string } = {}) {
    if (!canSubmitDeadlineRecovery() || onlineAuthoritativeGameStatePending || !activeRoomId || !activeSeat || roll || rollInProgress || rollAnimation || movingPieceId || moveInProgress) return false;
    if (turnRecoveryInFlightRef.current || timeoutRecoveryKeysRef.current.has(recoveryKey)) return false;
    turnRecoveryInFlightRef.current = true;
    timeoutRecoveryKeysRef.current.add(recoveryKey);""",
    'roll recovery inflight start',
)

replace_once(
    """      (error) => recordRemoteActionDiagnostic('roll_yut', 'turn-roll-timeout-recovery-error', error instanceof Error ? error.message : '윷 던지기 자동 진행에 실패했습니다.', { actionKey }),
      () => undefined,
    );""",
    """      (error) => recordRemoteActionDiagnostic('roll_yut', 'turn-roll-timeout-recovery-error', error instanceof Error ? error.message : '윷 던지기 자동 진행에 실패했습니다.', { actionKey }),
      () => { turnRecoveryInFlightRef.current = false; },
    );""",
    'roll recovery inflight finish',
)

replace_once(
    """  async function recoverStalledTurnMove(recoveryKey: string, options: { source?: string } = {}) {
    if (!activeRoomId || onlineAuthoritativeGameStatePending || !canSubmitDeadlineRecovery() || !activeSeat || !roll || !stalledTurnFallbackPiece) return false;
    if (stalledTurnRecoveryKeyRef.current === recoveryKey) return false;
    if (winner || rollResultHolding || rollAnimation || movingPieceId || moveInProgress || pendingTrapPlacement) return false;
    if (stalledTurnNeedsBranchChoice || stalledTurnRollStackAmbiguous) return false;

    stalledTurnRecoveryKeyRef.current = recoveryKey;""",
    """  async function recoverStalledTurnMove(recoveryKey: string, options: { source?: string } = {}) {
    if (!activeRoomId || onlineAuthoritativeGameStatePending || !canSubmitDeadlineRecovery() || !activeSeat || !roll || !stalledTurnFallbackPiece) return false;
    if (turnRecoveryInFlightRef.current || stalledTurnRecoveryKeyRef.current === recoveryKey) return false;
    if (winner || rollResultHolding || rollAnimation || movingPieceId || moveInProgress || pendingTrapPlacement) return false;
    if (stalledTurnNeedsBranchChoice || stalledTurnRollStackAmbiguous) return false;

    turnRecoveryInFlightRef.current = true;
    stalledTurnRecoveryKeyRef.current = recoveryKey;""",
    'move recovery inflight start',
)

replace_once(
    """      (error) => recordRemoteActionDiagnostic('move_piece', 'stalled-turn-recovery-error', error instanceof Error ? error.message : '멈춘 턴 자동 복구에 실패했습니다.', { actionKey: payload.clientActionId }),
      () => undefined,
    );""",
    """      (error) => recordRemoteActionDiagnostic('move_piece', 'stalled-turn-recovery-error', error instanceof Error ? error.message : '멈춘 턴 자동 복구에 실패했습니다.', { actionKey: payload.clientActionId }),
      () => { turnRecoveryInFlightRef.current = false; },
    );""",
    'move recovery inflight finish',
)

replace_once(
    """      const stalledResolution = getStalledTurnSyncResolution();
      if (stalledResolution.status === 'recoverable') void recoverStalledTurnMove(stalledResolution.recoveryKey, { source: 'page-resume' });""",
    """      const stalledResolution = getStalledTurnSyncResolution();
      if (stalledResolution.status === 'recoverable') void recoverStalledTurnMove(stalledResolution.recoveryKey, { source: 'page-resume' });
      void sequenceRecoveryWatchdogRef.current?.triggerNow();""",
    'page resume recovery',
)

replace_once(
    """    enqueueAuthoritativeResultApplication: (applyResult) => enqueueAuthoritativeResultApplication(activeRoomId, applyResult),
  });""",
    """    enqueueAuthoritativeResultApplication: (applyResult) => enqueueAuthoritativeResultApplication(activeRoomId, applyResult),
    onSnapshotReceived: () => {
      sequenceRecoveryWatchdogRef.current?.notifySnapshot();
    },
  });""",
    'snapshot activity hook',
)

old_polling = """  useEffect(() => {
    if (!activeRoomId || screen !== 'game' || isMyTurn || winner) return undefined;
    const timer = window.setInterval(() => {
      const now = Date.now();
      if (sequenceReplayInProgressRef.current || moveInProgressRef.current || now - lastSequenceWatchdogAtRef.current < SEQUENCE_WATCHDOG_MS) return;
      lastSequenceWatchdogAtRef.current = now;
      const localSequence = lastAppliedSequenceRef.current;
      void measureFirebaseLatency(() => getGameSequencesSince(activeRoomId, getSequenceRefetchAfter(localSequence))).then((sequences) => {
        const latestSequence = Math.max(0, ...sequences.map((sequence) => Number(sequence.sequence ?? 0)));
        const latestState = [...sequences].reverse().find((sequence) => sequence.stateAfter)?.stateAfter as SequenceStateSnapshot | undefined;
        if (latestSequence > localSequence && latestState) void replayMissingSequencesThenApply(latestState, localSequence, latestSequence);
      }).catch(() => undefined);
    }, SEQUENCE_WATCHDOG_MS);
    return () => window.clearInterval(timer);
  }, [activeRoomId, isMyTurn, screen, winner]);"""

new_watchdog = """  sequenceRecoveryCheckRef.current = async (): Promise<SequenceRecoveryCheckResult> => {
    const roomId = activeRoomId;
    if (!roomId || activeRoomIdRef.current !== roomId || screen !== 'game' || isMyTurn || winner) return 'deferred';
    if (
      sequenceReplayInProgressRef.current
      || moveInProgressRef.current
      || applyingSyncedStateRef.current
      || manualSequenceSyncing
      || pendingLocalRemoteActionsRef.current.size > 0
      || turnRecoveryInFlightRef.current
    ) return 'deferred';

    const localSequence = lastAppliedSequenceRef.current;
    try {
      const sequences = await measureFirebaseLatency(() => getGameSequencesSince(roomId, getSequenceRefetchAfter(localSequence)));
      if (activeRoomIdRef.current !== roomId) return 'deferred';
      const orderedSequences = sequences
        .filter((sequence) => Number(sequence.sequence ?? 0) > 0)
        .sort((left, right) => Number(left.sequence ?? 0) - Number(right.sequence ?? 0));
      const latestSequence = Math.max(localSequence, ...orderedSequences.map((sequence) => Number(sequence.sequence ?? 0)));
      const latestState = [...orderedSequences].reverse().find((sequence) => sequence.stateAfter)?.stateAfter as SequenceStateSnapshot | undefined;
      if (latestSequence <= localSequence || !latestState) return 'unchanged';
      await replayMissingSequencesThenApply(latestState, localSequence, latestSequence);
      return 'changed';
    } catch {
      return 'failed';
    }
  };

  const sequenceRecoveryWatchKey = activeRoomId && screen === 'game' && !isMyTurn && !winner
    ? `${activeRoomId}:${turnIndex}:${activeSeat?.id ?? 'none'}:${turnOrderIds.join(',')}:${roll?.name ?? 'ready'}:${roll?.steps ?? ''}:${turnDeadlineKind}:${turnDeadlineAt}:${lastMovedSeatId}:${lastMovedPieceIds.join(',')}`
    : '';

  useEffect(() => {
    sequenceRecoveryWatchdogRef.current?.update({
      active: Boolean(sequenceRecoveryWatchKey),
      key: sequenceRecoveryWatchKey,
    });
  }, [sequenceRecoveryWatchKey]);

  useEffect(() => () => {
    sequenceRecoveryWatchdogRef.current?.dispose();
  }, []);"""
replace_once(old_polling, new_watchdog, 'permanent sequence polling effect')

replace_once(
    """  useEffect(() => {
    if (!activeRoomId || screen !== 'game' || pendingLocalRemoteActionCount <= 0) return undefined;
    const timer = window.setInterval(() => {
      void reconcilePendingLocalRemoteActions().catch(() => undefined);
    }, SEQUENCE_WATCHDOG_MS);
    return () => window.clearInterval(timer);
  }, [activeRoomId, pendingLocalRemoteActionCount, screen]);""",
    """  useEffect(() => {
    if (!activeRoomId || screen !== 'game' || pendingLocalRemoteActionCount <= 0) return undefined;
    const timer = window.setInterval(() => {
      void reconcilePendingLocalRemoteActions().catch(() => undefined);
    }, SEQUENCE_RECOVERY_INITIAL_DELAY_MS);
    return () => window.clearInterval(timer);
  }, [activeRoomId, pendingLocalRemoteActionCount, screen]);""",
    'pending action reconciliation interval',
)

app_path.write_text(source)

test_path = Path('tests/unit/sequenceRecoveryWatchdog.test.ts')
test_source = test_path.read_text()
old_decl = "  let resolveCheck: ((result: SequenceRecoveryCheckResult) => void) | null = null;"
new_decl = "  let resolveCheck: (result: SequenceRecoveryCheckResult) => void = () => { throw new Error('복구 확인 resolver가 등록되지 않았습니다.'); };"
if test_source.count(old_decl) != 1:
    raise SystemExit(f'test resolver declaration: expected 1 match, found {test_source.count(old_decl)}')
test_source = test_source.replace(old_decl, new_decl, 1)
if test_source.count("  resolveCheck?.('unchanged');") != 1:
    raise SystemExit('test resolver call: expected 1 match')
test_source = test_source.replace("  resolveCheck?.('unchanged');", "  resolveCheck('unchanged');", 1)
test_path.write_text(test_source)
