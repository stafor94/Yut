import { useCallback } from 'react';
import type { ItemTiming, ItemType } from '../../features/items/logic/items';
import type { GameAction } from '../../features/room/services/roomService';
import type { FallEffect, SequenceStateSnapshot, Seat } from '../appState';
import { TURN_ACTION_TIMEOUT_MS } from '../../features/room/services/roomTiming';
import { buildSkipItemPromptPayload, getSkippedItemPromptNextDeadlineKind } from '../flows/itemControllerFlow';
import type { AuthoritativeCommitResult } from './useAuthoritativeGameSyncController';

type PendingMeta = { type?: GameAction['type']; actorId?: string; createdSequence?: number; createdTurnIndex?: number; optimisticApplied?: boolean };

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
  setTurnDeadlineKind: React.Dispatch<React.SetStateAction<'roll' | 'move' | 'turn_order' | 'item_prompt' | 'trap_placement' | ''>>;
  setTurnIndex: React.Dispatch<React.SetStateAction<number>>;
  setPendingAfterMoveTurnIndex: React.Dispatch<React.SetStateAction<number | null>>;
  setFallEffect: React.Dispatch<React.SetStateAction<FallEffect | null>>;
};

export function useItemController(params: Params) {
  const skipItemPrompt = useCallback(() => {
    if (params.activeRoomId) {
      const promptTiming = params.itemPromptTiming;
      if (!promptTiming || params.hasPendingUseItemActionFor(params.localSeatId)) return;
      const promptRollStackIndex = params.selectedRollStackIndex;
      const skipSeat = params.playableSeats.find((seat) => seat.id === params.localSeatId);
      const payload = buildSkipItemPromptPayload(promptTiming, promptRollStackIndex);
      const clientMutationId = params.getLocalActionKey('use_item', payload);
      if (params.pendingLocalRemoteActionsRef.current.has(clientMutationId)) return;
      const action = { type: 'use_item' as const, actorId: params.localSeatId, payload: params.withActorLogPayload({ ...payload, clientActionId: clientMutationId }, skipSeat) };
      params.shouldAdvanceTurnAfterItemPromptRef.current = false;
      params.markItemPromptResolved(promptTiming, promptRollStackIndex);
      params.setItemPromptTiming(null);
      const nextDeadlineKind = getSkippedItemPromptNextDeadlineKind(promptTiming);
      if (nextDeadlineKind === 'after_move_turn_advance') params.finishPendingAfterMoveTurnAdvance();
      else {
        params.setTurnDeadlineAt(Date.now() + TURN_ACTION_TIMEOUT_MS);
        params.setTurnDeadlineKind(nextDeadlineKind);
      }
      params.setPendingItemPromptChoice({ actionKey: clientMutationId, timing: promptTiming, itemType: null });
      params.addPendingLocalRemoteAction(clientMutationId, { type: 'use_item', actorId: params.localSeatId, createdSequence: params.lastAppliedSequenceRef.current, createdTurnIndex: params.turnIndex, optimisticApplied: true });
      void params.commitQueuedAuthoritativeGameAction(params.activeRoomId, action)
        .then(async (result) => {
          await params.enqueueAuthoritativeResultApplication(params.activeRoomId, () => params.applyAuthoritativeResultSequence(result));
          if (result.status === 'committed' || result.status === 'duplicate') params.acknowledgePendingLocalRemoteAction(clientMutationId);
          if (result.status === 'rejected' || result.status === 'unsupported') {
            params.setPendingItemPromptChoice((current) => current?.actionKey === clientMutationId ? null : current);
            params.removeSettledPendingLocalRemoteAction(clientMutationId);
            await params.syncLatestAuthoritativeState(result.reason ?? '서버가 아이템 건너뛰기를 거부해 최신 authoritative 상태로 재동기화합니다.', { diagnosticType: 'roll_yut' });
          }
        })
        .catch((error) => {
          params.recordRemoteActionDiagnostic('roll_yut', 'skip-item-prompt-error', error instanceof Error ? error.message : '아이템 건너뛰기 처리에 실패했습니다.', { actionKey: clientMutationId });
          void params.applyProcessedAuthoritativeAction(clientMutationId)
            .then((processedState) => processedState ? null : params.syncLatestAuthoritativeState('아이템 건너뛰기 처리 오류로 최신 authoritative 상태로 재동기화합니다.', { diagnosticType: 'roll_yut' }))
            .catch(() => { void params.syncLatestAuthoritativeState('아이템 건너뛰기 처리 오류로 최신 authoritative 상태로 재동기화합니다.', { diagnosticType: 'roll_yut' }); });
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
  }, [params]);

  return { skipItemPrompt };
}
