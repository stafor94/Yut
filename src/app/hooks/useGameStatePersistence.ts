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

export function useGameStatePersistence({
  activeRoomId, screen, canCoordinateOnlineGame, applyingSyncedStateRef, moveInProgressRef,
  movingPieceId, pieces, turnIndex, turnOrderIds, initialTurnOrderIds, completedSeatIds,
  rankingSeatIds, gameEndMode, lastFinishedSeatId, continuationRound, roll, rollStack, selectedRollStackIndex, rollStackClosed, boardItems,
  ownedItems, trapNodes, shieldedPieceIds, winner, gameStartedAt, turnOrderIntro,
  pendingTrapPlacement, rollLockUntil, lastMovedPieceIds, lastMovedSeatId,
  effectiveRollResultReadyAt, turnOrderPhase, waitingForPlayersReady, startRequestVersion,
  gameSeats, localSeatId, activeSeat, logs, captureEffect, trapEffect, fallEffect, lastRollTimingZone, lastAppliedSequenceRef,
  lastAppliedStateVersionRef, measureFirebaseLatency,
}: GameStatePersistenceParams) {
  const [coordinatorStateSaveKey, setCoordinatorStateSaveKey] = useState('');
  const [coordinatorStateSaveRetryTick, setCoordinatorStateSaveRetryTick] = useState(0);
  const pendingSequenceMetaRef = useRef<PendingSequenceMeta | null>(null);
  const lastSavedStateFingerprintRef = useRef('');
  const savingStateFingerprintRef = useRef('');

  useEffect(() => {
    if (!activeRoomId || screen !== 'game' || !canCoordinateOnlineGame || applyingSyncedStateRef.current) return;
    if (!pendingSequenceMetaRef.current) return;
    if (moveInProgressRef.current || movingPieceId) return;
    const stateFingerprint = makeGameStateFingerprint({ pieces, turnIndex, turnOrderIds, initialTurnOrderIds, completedSeatIds, rankingSeatIds, gameEndMode, lastFinishedSeatId, continuationRound, roll, rollStack, selectedRollStackIndex, rollStackClosed, boardItems, ownedItems, trapNodes, shieldedPieceIds, winner, gameStartedAt, turnOrderIntro, pendingTrapPlacement, rollLockUntil, lastMovedPieceIds, lastMovedSeatId, effectiveRollResultReadyAt, turnOrderPhase, waitingForPlayersReady, startRequestVersion, fallEffect, lastRollTimingZone, logs, gameSeats });
    if (lastSavedStateFingerprintRef.current === stateFingerprint || savingStateFingerprintRef.current === stateFingerprint) return;
    savingStateFingerprintRef.current = stateFingerprint;
    setCoordinatorStateSaveKey(stateFingerprint);
    const pendingSequenceMeta = pendingSequenceMetaRef.current;
    pendingSequenceMetaRef.current = null;
    const sequenceType = pendingSequenceMeta?.type ?? (winner && gameEndMode !== 'partial_finish' ? 'game_finished' : lastMovedSeatId === localSeatId ? 'move_piece_resolved' : pendingTrapPlacement?.ownerId === localSeatId ? 'item_used' : 'state_snapshot');
    const sequenceActorId = pendingSequenceMeta?.actorId ?? localSeatId;
    const sequencePayload = pendingSequenceMeta?.payload ?? { turnIndex, activeSeatId: activeSeat?.id ?? '', rollName: roll?.name ?? null, lastMovedPieceIds, lastMovedSeatId };
    const clientMutationId = pendingSequenceMeta?.clientMutationId ?? `${sequenceType}:${sequenceActorId}:${stateFingerprint}`;
    let keepCoordinatorStateSavePending = false;
    void measureFirebaseLatency(() => saveGameState(activeRoomId, { pieces, turnIndex, turnOrderIds, initialTurnOrderIds, completedSeatIds, rankingSeatIds, gameEndMode, lastFinishedSeatId, continuationRound, roll, rollStack, selectedRollStackIndex, rollStackClosed, boardItems, ownedItems, trapNodes, shieldedPieceIds, logs, winner, captureEffect, trapEffect, fallEffect, lastRollTimingZone, gameStartedAt, turnOrderIntro, pendingTrapPlacement, rollLockUntil, lastMovedPieceIds, lastMovedSeatId, rollResultReadyAt: effectiveRollResultReadyAt, turnOrderPhase, waitingForPlayersReady, startRequestVersion, gameSeats }, { type: sequenceType, actorId: sequenceActorId, clientMutationId, payload: sequencePayload, action: pendingSequenceMeta?.action ?? null, expectedPreviousSequence: lastAppliedSequenceRef.current })).then((result: any) => {
      if (typeof result.lastSequence === 'number') lastAppliedSequenceRef.current = Math.max(lastAppliedSequenceRef.current, result.lastSequence);
      if ((result.status === 'committed' || result.status === 'duplicate') && result.turnVersion) {
        lastAppliedStateVersionRef.current = Math.max(lastAppliedStateVersionRef.current, result.turnVersion);
        lastSavedStateFingerprintRef.current = stateFingerprint;
      }
      if (result.status === 'sequence_mismatch') {
        keepCoordinatorStateSavePending = true;
        if (savingStateFingerprintRef.current === stateFingerprint) savingStateFingerprintRef.current = '';
        setCoordinatorStateSaveRetryTick((tick) => tick + 1);
      }
    }).finally(() => {
      if (!keepCoordinatorStateSavePending && savingStateFingerprintRef.current === stateFingerprint) savingStateFingerprintRef.current = '';
      if (!keepCoordinatorStateSavePending) setCoordinatorStateSaveKey((current) => current === stateFingerprint ? '' : current);
    });
  }, [activeRoomId, activeSeat?.id, activeSeat?.isAI, boardItems, captureEffect, fallEffect, lastRollTimingZone, completedSeatIds, continuationRound, effectiveRollResultReadyAt, gameEndMode, gameStartedAt, canCoordinateOnlineGame, coordinatorStateSaveRetryTick, initialTurnOrderIds, lastFinishedSeatId, lastMovedPieceIds, lastMovedSeatId, localSeatId, logs, gameSeats, movingPieceId, ownedItems, pendingTrapPlacement, pieces, rankingSeatIds, roll, rollStack, selectedRollStackIndex, rollStackClosed, rollLockUntil, screen, shieldedPieceIds, trapEffect, trapNodes, turnIndex, turnOrderIds, turnOrderIntro, turnOrderPhase, waitingForPlayersReady, startRequestVersion, winner]);

  return {
    coordinatorStateSaveKey,
    setCoordinatorStateSaveKey,
    coordinatorStateSaveRetryTick,
    pendingSequenceMetaRef,
    lastSavedStateFingerprintRef,
    savingStateFingerprintRef,
  };
}
