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
  rankingSeatIds, gameEndMode, lastFinishedSeatId, continuationRound, roll, boardItems,
  ownedItems, trapNodes, shieldedPieceIds, winner, gameStartedAt, turnOrderIntro,
  pendingTrapPlacement, rollLockUntil, lastMovedPieceIds, lastMovedSeatId,
  effectiveRollResultReadyAt, turnOrderPhase, waitingForPlayersReady, startRequestVersion,
  localSeatId, activeSeat, logs, captureEffect, trapEffect, lastAppliedSequenceRef,
  lastAppliedStateVersionRef, measureFirebaseLatency,
}: GameStatePersistenceParams) {
  const [hostStateSaveKey, setHostStateSaveKey] = useState('');
  const [hostStateSaveRetryTick, setHostStateSaveRetryTick] = useState(0);
  const pendingSequenceMetaRef = useRef<PendingSequenceMeta | null>(null);
  const lastSavedStateFingerprintRef = useRef('');
  const savingStateFingerprintRef = useRef('');

  useEffect(() => {
    if (!activeRoomId || screen !== 'game' || !canCoordinateOnlineGame || applyingSyncedStateRef.current) return;
    if (!pendingSequenceMetaRef.current) return;
    if (moveInProgressRef.current || movingPieceId) return;
    const stateFingerprint = makeGameStateFingerprint({ pieces, turnIndex, turnOrderIds, initialTurnOrderIds, completedSeatIds, rankingSeatIds, gameEndMode, lastFinishedSeatId, continuationRound, roll, boardItems, ownedItems, trapNodes, shieldedPieceIds, winner, gameStartedAt, turnOrderIntro, pendingTrapPlacement, rollLockUntil, lastMovedPieceIds, lastMovedSeatId, effectiveRollResultReadyAt, turnOrderPhase, waitingForPlayersReady, startRequestVersion });
    if (lastSavedStateFingerprintRef.current === stateFingerprint || savingStateFingerprintRef.current === stateFingerprint) return;
    savingStateFingerprintRef.current = stateFingerprint;
    setHostStateSaveKey(stateFingerprint);
    const pendingSequenceMeta = pendingSequenceMetaRef.current;
    pendingSequenceMetaRef.current = null;
    const sequenceType = pendingSequenceMeta?.type ?? (winner && gameEndMode !== 'partial_finish' ? 'game_finished' : lastMovedSeatId === localSeatId ? 'move_piece_resolved' : pendingTrapPlacement?.ownerId === localSeatId ? 'item_used' : 'state_snapshot');
    const sequenceActorId = pendingSequenceMeta?.actorId ?? localSeatId;
    const sequencePayload = pendingSequenceMeta?.payload ?? { turnIndex, activeSeatId: activeSeat?.id ?? '', rollName: roll?.name ?? null, lastMovedPieceIds, lastMovedSeatId };
    const clientMutationId = pendingSequenceMeta?.clientMutationId ?? `${sequenceType}:${sequenceActorId}:${stateFingerprint}`;
    let keepHostStateSavePending = false;
    void measureFirebaseLatency(() => saveGameState(activeRoomId, { pieces, turnIndex, turnOrderIds, initialTurnOrderIds, completedSeatIds, rankingSeatIds, gameEndMode, lastFinishedSeatId, continuationRound, roll, boardItems, ownedItems, trapNodes, shieldedPieceIds, logs, winner, captureEffect, trapEffect, gameStartedAt, turnOrderIntro, pendingTrapPlacement, rollLockUntil, lastMovedPieceIds, lastMovedSeatId, rollResultReadyAt: effectiveRollResultReadyAt, turnOrderPhase, waitingForPlayersReady, startRequestVersion }, { type: sequenceType, actorId: sequenceActorId, clientMutationId, payload: sequencePayload, action: pendingSequenceMeta?.action ?? null, expectedPreviousSequence: lastAppliedSequenceRef.current })).then((result: any) => {
      if (typeof result.lastSequence === 'number') lastAppliedSequenceRef.current = Math.max(lastAppliedSequenceRef.current, result.lastSequence);
      if ((result.status === 'committed' || result.status === 'duplicate') && result.turnVersion) {
        lastAppliedStateVersionRef.current = Math.max(lastAppliedStateVersionRef.current, result.turnVersion);
        lastSavedStateFingerprintRef.current = stateFingerprint;
      }
      if (result.status === 'sequence_mismatch') {
        keepHostStateSavePending = true;
        if (savingStateFingerprintRef.current === stateFingerprint) savingStateFingerprintRef.current = '';
        setHostStateSaveRetryTick((tick) => tick + 1);
      }
    }).finally(() => {
      if (!keepHostStateSavePending && savingStateFingerprintRef.current === stateFingerprint) savingStateFingerprintRef.current = '';
      if (!keepHostStateSavePending) setHostStateSaveKey((current) => current === stateFingerprint ? '' : current);
    });
  }, [activeRoomId, activeSeat?.id, activeSeat?.isAI, boardItems, captureEffect, completedSeatIds, continuationRound, effectiveRollResultReadyAt, gameEndMode, gameStartedAt, canCoordinateOnlineGame, hostStateSaveRetryTick, initialTurnOrderIds, lastFinishedSeatId, lastMovedPieceIds, lastMovedSeatId, localSeatId, logs, movingPieceId, ownedItems, pendingTrapPlacement, pieces, rankingSeatIds, roll, rollLockUntil, screen, shieldedPieceIds, trapEffect, trapNodes, turnIndex, turnOrderIds, turnOrderIntro, turnOrderPhase, waitingForPlayersReady, startRequestVersion, winner]);

  return {
    hostStateSaveKey,
    setHostStateSaveKey,
    hostStateSaveRetryTick,
    pendingSequenceMetaRef,
    lastSavedStateFingerprintRef,
    savingStateFingerprintRef,
  };
}
