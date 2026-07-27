import { useCallback, useEffect, useRef } from 'react';
import type { ItemTiming, ItemType } from '../../features/items/logic/items';
import type { GameAction } from '../../features/room/services/roomService';
import type { FallEffect, SequenceStateSnapshot, Seat } from '../appState';
import { TURN_ACTION_TIMEOUT_MS } from '../../features/room/services/roomTiming';
import { STALE_PENDING_REMOTE_ACTION_MS } from '../config/gameTimings';
import { getQaUseItemActionDelayMs } from '../config/qaDelays';
import {
  buildSkipItemPromptPayload,
  getSkippedItemPromptNextDeadlineKind,
  isCurrentItemPromptRequestRoom,
} from '../flows/itemControllerFlow';
import type { AuthoritativeCommitResult } from './useAuthoritativeGameSyncController';

type PendingMeta = { type?: GameAction['type']; actorId?: string; createdSequence?: number; createdTurnIndex?: number; optimisticApplied?: boolean; blocksTurnActions?: boolean };

type PendingItemPromptChoice = { actionKey: string; timing: ItemTiming; itemType: ItemType | null } | null;

type Params = {
  activeRoomId: string;
  localSeatId: string;
  turnIndex: number;
  selectedRollStackIndex: number | null;
  pendingAfterMoveTurnIndex: number | null;
  lastAppliedSequenceRef: React.MutableRefObject<number>;
  shouldAdvanceTurnAfterItemPromptRef: React.MutableRefObject<boolean>;
  playableSeats: Seat[];
  itemPromptTiming: ItemTiming | null;
  pendingLocalRemoteActionsRef: React.MutableRefObject<Set<string>>;
  hasPendingUseItemActionFor: (actorId?: string) => boolean;
  getLocalActionKey: (type: GameAction['type'], payload?: Record<string, unknown>) => string;
  withActorLogPayload: (payload?: Record<string, unknown>, seat?: Seat) => Record<string, unknown>;
  addPendingLocalRemoteAction: (actionKey: string, metadata?: PendingMeta) => void;
  acknowledgePendingLocalRemoteAction: (clientMutationId: unknown) => void;
  removeSettledPendingLocalRemoteAction: (actionKey: string) => void;
  commitQueuedAuthoritativeGameAction: (roomId: string, action: Omit<GameAction, 'id' | 'createdAt' | 'processed'>) => Promise<AuthoritativeCommitResult>;
  enqueueAuthoritativeResultApplication: <T>(roomId: string, applyResult: () => Promise<T> | T) => Promise<T | null>;
  applyAuthoritativeResultSequence: (result: AuthoritativeCommitResult) => Promise<SequenceStateSnapshot | null | unknown>;
  syncLatestAuthoritativeState: (reason: string, options?: { diagnosticType?: 'roll_yut' | 'move_piece' }) => Promise<boolean>;
  applyProcessedAuthoritativeAction: (actionKey: string) => Promise<SequenceStateSnapshot | null>;
  recordRemoteActionDiagnostic: (type: 'roll_yut' | 'move_piece', stage: string, messageText: string, params?: { status?: string; actionKey?: string }) => void;
  clearTurnActionTimeoutPenalty: (seatId?: string) => void;
  markItemPromptResolved: (timing: ItemTiming | null, promptRollStackIndex?: number | null) => void;
  finishPendingAfterMoveTurnAdvance: () => void;
  clearRoll: () => void;
  setItemPromptTiming: React.Dispatch<React.SetStateAction<ItemTiming | null>>;
  setPendingItemPromptChoice: React.Dispatch<React.SetStateAction<PendingItemPromptChoice>>;
  setTurnDeadlineAt: React.Dispatch<React.SetStateAction<number>>;
  setTurnDeadlineKind: React.Dispatch<React.SetStateAction<'roll' | 'move' | 'item_prompt' | 'trap_placement' | ''>>;
  setTurnIndex: React.Dispatch<React.SetStateAction<number>>;
  setPendingAfterMoveTurnIndex: React.Dispatch<React.SetStateAction<number | null>>;
  setFallEffect: React.Dispatch<React.SetStateAction<FallEffect | null>>;
};

export function useItemController(params: Params) {
  const activeRoomIdRef = useRef(params.activeRoomId);
  const paramsRef = useRef(params);
  const pendingSkipRecoveryTimerRef = useRef<number | null>(null);
  activeRoomIdRef.current = params.activeRoomId;
  paramsRef.current = params;

  const clearPendingSkipRecoveryTimer = useCallback(() => {
    if (pendingSkipRecoveryTimerRef.current === null) return;
    window.clearTimeout(pendingSkipRecoveryTimerRef.current);
    pendingSkipRecoveryTimerRef.current = null;
  }, []);

  const clearPendingItemPromptChoice = useCallback((actionKey: string) => {
    paramsRef.current.setPendingItemPromptChoice((current) => current?.actionKey === actionKey ? null : current);
  }, []);

  const recoverPendingSkip = useCallback(async (requestRoomId: string, actionKey: string) => {
    if (!isCurrentItemPromptRequestRoom(requestRoomId, activeRoomIdRef.current)) return false;
    let recovered = false;
    const currentParams = paramsRef.current;
    try {
      const processedState = await currentParams.applyProcessedAuthoritativeAction(actionKey);
      recovered = Boolean(processedState);
      if (!recovered) recovered = await currentParams.syncLatestAuthoritativeState('아이템 선택 서버 확정 상태를 확인하기 위해 최신 authoritative 상태로 재동기화합니다.', { diagnosticType: 'roll_yut' });
    } catch {
      recovered = await currentParams.syncLatestAuthoritativeState('아이템 선택 서버 확정 상태를 확인하기 위해 최신 authoritative 상태로 재동기화합니다.', { diagnosticType: 'roll_yut' });
    }
    if (!recovered || !isCurrentItemPromptRequestRoom(requestRoomId, activeRoomIdRef.current)) return false;
    currentParams.removeSettledPendingLocalRemoteAction(actionKey);
    clearPendingItemPromptChoice(actionKey);
    clearPendingSkipRecoveryTimer();
    return true;
  }, [clearPendingItemPromptChoice, clearPendingSkipRecoveryTimer]);

  useEffect(() => () => clearPendingSkipRecoveryTimer(), [clearPendingSkipRecoveryTimer, params.activeRoomId]);

  const skipItemPrompt = useCallback((_options: { timedOut?: boolean } = {}) => {
    if (params.activeRoomId) {
      const requestRoomId = params.activeRoomId;
      const promptTiming = params.itemPromptTiming;
      if (!promptTiming || params.hasPendingUseItemActionFor(params.localSeatId)) return;
      const promptRollStackIndex = params.selectedRollStackIndex;
      const skipSeat = params.playableSeats.find((seat) => seat.id === params.localSeatId);
      const actionStartedAt = Date.now();
      const payload = buildSkipItemPromptPayload(promptTiming, promptRollStackIndex);
      const clientMutationId = params.getLocalActionKey('use_item', payload);
      if (params.pendingLocalRemoteActionsRef.current.has(clientMutationId)) return;
      const action = {
        type: 'use_item' as const,
        actorId: params.localSeatId,
        payload: params.withActorLogPayload({ ...payload, clientActionStartedAt: actionStartedAt, clientActionId: clientMutationId }, skipSeat),
      };
      params.shouldAdvanceTurnAfterItemPromptRef.current = false;
      const pendingChoice = { actionKey: clientMutationId, timing: promptTiming, itemType: null };
      params.setPendingItemPromptChoice(pendingChoice);
      params.addPendingLocalRemoteAction(clientMutationId, {
        type: 'use_item',
        actorId: params.localSeatId,
        createdSequence: params.lastAppliedSequenceRef.current,
        createdTurnIndex: params.turnIndex,
        optimisticApplied: true,
        blocksTurnActions: true,
      });
      clearPendingSkipRecoveryTimer();
      pendingSkipRecoveryTimerRef.current = window.setTimeout(() => {
        pendingSkipRecoveryTimerRef.current = null;
        void recoverPendingSkip(requestRoomId, clientMutationId);
      }, Math.max(0, STALE_PENDING_REMOTE_ACTION_MS - 1_000));
      params.markItemPromptResolved(promptTiming, promptRollStackIndex);
      params.setItemPromptTiming(null);
      const nextDeadlineKind = getSkippedItemPromptNextDeadlineKind(promptTiming);
      if (nextDeadlineKind === 'after_move_turn_advance') params.finishPendingAfterMoveTurnAdvance();
      else {
        params.setTurnDeadlineAt(Date.now() + TURN_ACTION_TIMEOUT_MS);
        params.setTurnDeadlineKind(nextDeadlineKind);
      }
      const commitSkipAction = async () => {
        const qaDelayMs = getQaUseItemActionDelayMs();
        if (qaDelayMs > 0) await new Promise((resolve) => window.setTimeout(resolve, qaDelayMs));
        return params.commitQueuedAuthoritativeGameAction(requestRoomId, action);
      };
      void commitSkipAction()
        .then(async (result) => {
          await params.enqueueAuthoritativeResultApplication(requestRoomId, () => params.applyAuthoritativeResultSequence(result));
          if (!isCurrentItemPromptRequestRoom(requestRoomId, activeRoomIdRef.current)) return;
          if (result.status === 'committed' || result.status === 'duplicate') {
            params.acknowledgePendingLocalRemoteAction(clientMutationId);
            clearPendingItemPromptChoice(clientMutationId);
            clearPendingSkipRecoveryTimer();
            return;
          }
          if (result.status === 'rejected' || result.status === 'unsupported') {
            const recovered = await params.syncLatestAuthoritativeState(result.reason ?? '서버가 아이템 건너뛰기를 거부해 최신 authoritative 상태로 재동기화합니다.', { diagnosticType: 'roll_yut' });
            if (!recovered || !isCurrentItemPromptRequestRoom(requestRoomId, activeRoomIdRef.current)) return;
            params.removeSettledPendingLocalRemoteAction(clientMutationId);
            clearPendingItemPromptChoice(clientMutationId);
            clearPendingSkipRecoveryTimer();
          }
        })
        .catch((error) => {
          if (!isCurrentItemPromptRequestRoom(requestRoomId, activeRoomIdRef.current)) return;
          params.recordRemoteActionDiagnostic('roll_yut', 'skip-item-prompt-error', error instanceof Error ? error.message : '아이템 건너뛰기 처리에 실패했습니다.', { actionKey: clientMutationId });
          void recoverPendingSkip(requestRoomId, clientMutationId);
        });
      return;
    }
    params.clearTurnActionTimeoutPenalty(params.localSeatId);
    const skippedTiming = params.itemPromptTiming;
    params.setItemPromptTiming(null);
    params.markItemPromptResolved(skippedTiming, params.selectedRollStackIndex);
    if (skippedTiming === 'after_move') params.finishPendingAfterMoveTurnAdvance();
    else if (skippedTiming === 'after_roll' && typeof params.pendingAfterMoveTurnIndex === 'number') {
      params.clearRoll();
      params.setTurnIndex(params.pendingAfterMoveTurnIndex);
      params.setPendingAfterMoveTurnIndex(null);
      params.setFallEffect(null);
      params.setTurnDeadlineAt(Date.now() + TURN_ACTION_TIMEOUT_MS);
      params.setTurnDeadlineKind('roll');
    }
  }, [clearPendingItemPromptChoice, clearPendingSkipRecoveryTimer, params, recoverPendingSkip]);

  return { skipItemPrompt };
}
