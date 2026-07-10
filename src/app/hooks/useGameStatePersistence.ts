import { useEffect, useRef, useState } from 'react';
import { saveGameState, type GameAction, type GameSequenceType } from '../../features/room/services/roomService';
import { makeGameStateFingerprint } from '../appState';

type PendingSequenceMeta = {
  type: GameSequenceType;
  actorId: string;
  payload?: Record<string, unknown>;
  action?: Omit<GameAction, 'id' | 'createdAt' | 'processed'> | null;
  clientMutationId?: string;
};

type GameStatePersistenceParams = Record<string, any>;

const MAX_COORDINATOR_SAVE_RETRY_COUNT = 4;
const COORDINATOR_SAVE_RETRY_BASE_DELAY_MS = 500;

export function useGameStatePersistence({
  activeRoomId, screen, canCoordinateOnlineGame, applyingSyncedStateRef, moveInProgressRef,
  movingPieceId, pieces, turnIndex, turnOrderIds, initialTurnOrderIds, completedSeatIds,
  rankingSeatIds, gameEndMode, lastFinishedSeatId, continuationRound, roll, rollStack, selectedRollStackIndex, rollStackClosed, boardItems,
  ownedItems, trapNodes, shieldedPieceIds, winner, gameStartedAt, turnOrderIntro,
  pendingTrapPlacement, itemPromptTiming, pendingAfterMoveTurnIndex, rollLockUntil, lastMovedPieceIds, lastMovedSeatId,
  effectiveRollResultReadyAt, turnOrderPhase, waitingForPlayersReady, turnDeadlineAt, turnDeadlineKind, startRequestVersion,
  gameSeats, localSeatId, activeSeat, logs, captureEffect, trapEffect, fallEffect, lastRollTimingZone, lastAppliedSequenceRef,
  lastAppliedStateVersionRef, measureFirebaseLatency,
}: GameStatePersistenceParams) {
  const [coordinatorStateSaveKey, setCoordinatorStateSaveKey] = useState('');
  const [coordinatorStateSaveRetryTick, setCoordinatorStateSaveRetryTick] = useState(0);
  const pendingSequenceMetaRef = useRef<PendingSequenceMeta | null>(null);
  const lastSavedStateFingerprintRef = useRef('');
  const savingStateFingerprintRef = useRef('');
  const coordinatorSaveRetryRef = useRef<{ roomId: string; fingerprint: string; count: number; timer: number }>({ roomId: '', fingerprint: '', count: 0, timer: 0 });

  useEffect(() => () => {
    if (coordinatorSaveRetryRef.current.timer) window.clearTimeout(coordinatorSaveRetryRef.current.timer);
  }, []);

  useEffect(() => {
    if (!activeRoomId || coordinatorSaveRetryRef.current.roomId !== activeRoomId) {
      if (coordinatorSaveRetryRef.current.timer) window.clearTimeout(coordinatorSaveRetryRef.current.timer);
      coordinatorSaveRetryRef.current = { roomId: activeRoomId ?? '', fingerprint: '', count: 0, timer: 0 };
    }
  }, [activeRoomId]);

  useEffect(() => {
    if (!activeRoomId || screen !== 'game' || !canCoordinateOnlineGame || applyingSyncedStateRef.current) return;
    if (!pendingSequenceMetaRef.current) return;
    if (moveInProgressRef.current || movingPieceId) return;
    const stateFingerprint = makeGameStateFingerprint({ pieces, turnIndex, turnOrderIds, initialTurnOrderIds, completedSeatIds, rankingSeatIds, gameEndMode, lastFinishedSeatId, continuationRound, roll, rollStack, selectedRollStackIndex, rollStackClosed, boardItems, ownedItems, trapNodes, shieldedPieceIds, winner, gameStartedAt, turnOrderIntro, pendingTrapPlacement, itemPromptTiming, pendingAfterMoveTurnIndex, rollLockUntil, lastMovedPieceIds, lastMovedSeatId, effectiveRollResultReadyAt, turnOrderPhase, waitingForPlayersReady, turnDeadlineAt, turnDeadlineKind, startRequestVersion, fallEffect, lastRollTimingZone, logs, gameSeats });
    if (lastSavedStateFingerprintRef.current === stateFingerprint || savingStateFingerprintRef.current === stateFingerprint) return;
    savingStateFingerprintRef.current = stateFingerprint;
    setCoordinatorStateSaveKey(stateFingerprint);
    const pendingSequenceMeta = pendingSequenceMetaRef.current;
    const sequenceType = pendingSequenceMeta?.type ?? (winner && gameEndMode !== 'partial_finish' ? 'game_finished' : lastMovedSeatId === localSeatId ? 'move_piece_resolved' : pendingTrapPlacement?.ownerId === localSeatId ? 'item_used' : 'state_snapshot');
    const sequenceActorId = pendingSequenceMeta?.actorId ?? localSeatId;
    const sequencePayload = pendingSequenceMeta?.payload ?? { turnIndex, activeSeatId: activeSeat?.id ?? '', rollName: roll?.name ?? null, lastMovedPieceIds, lastMovedSeatId };
    const clientMutationId = pendingSequenceMeta?.clientMutationId ?? `${sequenceType}:${sequenceActorId}:${stateFingerprint}`;
    const scheduleCoordinatorRetry = () => {
      const previous = coordinatorSaveRetryRef.current.roomId === activeRoomId && coordinatorSaveRetryRef.current.fingerprint === stateFingerprint
        ? coordinatorSaveRetryRef.current.count
        : 0;
      if (previous >= MAX_COORDINATOR_SAVE_RETRY_COUNT) {
        pendingSequenceMetaRef.current = null;
        setCoordinatorStateSaveKey('');
        return false;
      }
      const nextCount = previous + 1;
      const delayMs = COORDINATOR_SAVE_RETRY_BASE_DELAY_MS * (2 ** (nextCount - 1));
      if (coordinatorSaveRetryRef.current.timer) window.clearTimeout(coordinatorSaveRetryRef.current.timer);
      const timer = window.setTimeout(() => setCoordinatorStateSaveRetryTick((tick) => tick + 1), delayMs);
      coordinatorSaveRetryRef.current = { roomId: activeRoomId, fingerprint: stateFingerprint, count: nextCount, timer };
      return true;
    };
    let keepCoordinatorStateSavePending = false;
    void measureFirebaseLatency(() => saveGameState(activeRoomId, { pieces, turnIndex, turnOrderIds, initialTurnOrderIds, completedSeatIds, rankingSeatIds, gameEndMode, lastFinishedSeatId, continuationRound, roll, rollStack, selectedRollStackIndex, rollStackClosed, boardItems, ownedItems, trapNodes, shieldedPieceIds, logs, winner, captureEffect, trapEffect, fallEffect, lastRollTimingZone, gameStartedAt, turnOrderIntro, pendingTrapPlacement, itemPromptTiming, pendingAfterMoveTurnIndex, rollLockUntil, lastMovedPieceIds, lastMovedSeatId, rollResultReadyAt: effectiveRollResultReadyAt, turnOrderPhase, waitingForPlayersReady, turnDeadlineAt, turnDeadlineKind, startRequestVersion, gameSeats }, { type: sequenceType, actorId: sequenceActorId, clientMutationId, payload: sequencePayload, action: pendingSequenceMeta?.action ?? null, expectedPreviousSequence: lastAppliedSequenceRef.current })).then((result: any) => {
      if (typeof result.lastSequence === 'number') lastAppliedSequenceRef.current = Math.max(lastAppliedSequenceRef.current, result.lastSequence);
      if ((result.status === 'committed' || result.status === 'duplicate') && result.turnVersion) {
        lastAppliedStateVersionRef.current = Math.max(lastAppliedStateVersionRef.current, result.turnVersion);
        lastSavedStateFingerprintRef.current = stateFingerprint;
        if (coordinatorSaveRetryRef.current.timer) window.clearTimeout(coordinatorSaveRetryRef.current.timer);
        coordinatorSaveRetryRef.current = { roomId: activeRoomId, fingerprint: '', count: 0, timer: 0 };
      }
      if (result.status === 'committed' || result.status === 'duplicate') {
        if (pendingSequenceMetaRef.current?.clientMutationId === pendingSequenceMeta?.clientMutationId) pendingSequenceMetaRef.current = null;
      }
      if (result.status === 'sequence_mismatch') {
        pendingSequenceMetaRef.current = null;
        if (typeof result.lastSequence === 'number') lastAppliedSequenceRef.current = Math.max(lastAppliedSequenceRef.current, result.lastSequence);
        if (savingStateFingerprintRef.current === stateFingerprint) savingStateFingerprintRef.current = '';
        if (coordinatorSaveRetryRef.current.timer) window.clearTimeout(coordinatorSaveRetryRef.current.timer);
        coordinatorSaveRetryRef.current = { roomId: activeRoomId, fingerprint: '', count: 0, timer: 0 };
      }
    }).catch(() => {
      keepCoordinatorStateSavePending = true;
      pendingSequenceMetaRef.current = pendingSequenceMeta;
      if (savingStateFingerprintRef.current === stateFingerprint) savingStateFingerprintRef.current = '';
      keepCoordinatorStateSavePending = scheduleCoordinatorRetry();
    }).finally(() => {
      if (!keepCoordinatorStateSavePending && savingStateFingerprintRef.current === stateFingerprint) savingStateFingerprintRef.current = '';
      if (!keepCoordinatorStateSavePending) setCoordinatorStateSaveKey((current) => current === stateFingerprint ? '' : current);
    });
  }, [activeRoomId, activeSeat?.id, activeSeat?.isAI, boardItems, captureEffect, fallEffect, lastRollTimingZone, completedSeatIds, continuationRound, effectiveRollResultReadyAt, gameEndMode, gameStartedAt, canCoordinateOnlineGame, coordinatorStateSaveRetryTick, initialTurnOrderIds, lastFinishedSeatId, lastMovedPieceIds, lastMovedSeatId, localSeatId, logs, gameSeats, itemPromptTiming, movingPieceId, ownedItems, pendingAfterMoveTurnIndex, pendingTrapPlacement, pieces, rankingSeatIds, roll, rollStack, selectedRollStackIndex, rollStackClosed, rollLockUntil, screen, shieldedPieceIds, trapEffect, trapNodes, turnDeadlineAt, turnDeadlineKind, turnIndex, turnOrderIds, turnOrderIntro, turnOrderPhase, waitingForPlayersReady, startRequestVersion, winner]);

  return {
    coordinatorStateSaveKey,
    setCoordinatorStateSaveKey,
    coordinatorStateSaveRetryTick,
    pendingSequenceMetaRef,
    lastSavedStateFingerprintRef,
    savingStateFingerprintRef,
  };
}
