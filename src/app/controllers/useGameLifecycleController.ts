import { useCallback } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import { removeRoomPlayer, updateRoomPlayer, updateRoomStatus, type GameAction, type GameSequence } from '../../features/room/services/roomService';
import { applySequenceEvents } from '../hooks/applySequenceEvent';
import { getSequenceRefetchAfter } from '../utils/sequenceRefetch';
import { createSeats, type PendingItemPickup, type PlayMode, type Screen, type Seat, type SequenceStateSnapshot } from '../appState';
import type { ItemTiming } from '../../features/items/logic/items';
import { STORAGE_KEYS } from '../appState';
import { getSubstitutedRoomPlayerUpdate } from './useWaitingRoomController';

export type GameLifecycleControllerParams = {
  activeRoomId: string;
  activeRoomHostId: string;
  activeRoomIdRef: MutableRefObject<string>;
  canShowContinueRaceButton: boolean;
  continuationRound: number;
  confirmedRoomPlayerRef: MutableRefObject<boolean>;
  currentSequenceStateRef: MutableRefObject<SequenceStateSnapshot | null>;
  hostingRoomUserIdRef: MutableRefObject<string>;
  enqueueAuthoritativeGameAction: (
    roomId: string,
    action: Omit<GameAction, 'id' | 'createdAt' | 'processed'>,
    handleResult: (result: { status: string; reason?: string; sequence?: number }) => Promise<void> | void,
    handleError: (error: unknown) => void,
    handleFinally: () => void,
  ) => void;
  getGameSequencesSince: (roomId: string, sequence: number) => Promise<GameSequence[]>;
  lastAppliedSequenceRef: MutableRefObject<number>;
  leavingRoomRef: MutableRefObject<boolean>;
  localSeatId: string;
  maxPlayers: 2 | 3 | 4;
  nickname: string;
  pendingItemPickupRef: MutableRefObject<PendingItemPickup | null>;
  playMode: PlayMode;
  reconcilePendingLocalRemoteActions: (options?: { forceStaleClear?: boolean }) => Promise<boolean>;
  replayMissingSequencesThenApply: (finalState: SequenceStateSnapshot, localSequence: number, resultSequence: number) => Promise<void>;
  screen: Screen;
  seats: Seat[];
  setActiveRoomHostId: Dispatch<SetStateAction<string>>;
  setActiveRoomId: Dispatch<SetStateAction<string>>;
  setActiveRoomTitle: Dispatch<SetStateAction<string>>;
  setCountdown: Dispatch<SetStateAction<number>>;
  setEndGameDialogOpen: Dispatch<SetStateAction<boolean>>;
  setGameStartedAt: Dispatch<SetStateAction<number | null>>;
  setIsRoomHost: Dispatch<SetStateAction<boolean>>;
  setItemPromptTiming: Dispatch<SetStateAction<ItemTiming | null>>;
  setMessage: Dispatch<SetStateAction<string>>;
  setPendingItemPickup: Dispatch<SetStateAction<PendingItemPickup | null>>;
  setScreen: Dispatch<SetStateAction<Screen>>;
  setSeats: Dispatch<SetStateAction<Seat[]>>;
  setTurnOrderIds: Dispatch<SetStateAction<string[]>>;
  addPendingAiSeat: (seatId: string) => void;
  clearPendingAiSeat: (seatId: string) => void;
  addPendingLocalRemoteAction: (actionKey: string, metadata?: { type?: GameAction['type']; actorId?: string; createdSequence?: number; createdTurnIndex?: number; optimisticApplied?: boolean }) => void;
  acknowledgePendingLocalRemoteAction: (actionKey: unknown) => void;
  removeSettledPendingLocalRemoteAction: (actionKey: string) => void;
  syncLatestAuthoritativeState: (reason: string, options?: { diagnosticType?: 'roll_yut' | 'move_piece' }) => Promise<boolean>;
  turnIndex: number;
  winner: string;
};

export function useGameLifecycleController(params: GameLifecycleControllerParams) {
  const returnToWaitingRoom = useCallback(() => {
    const finishedRoomId = params.activeRoomId;
    params.setSeats((currentSeats) => currentSeats.map((seat) => {
      if (seat.isSubstitutedByAI) return { ...seat, id: `slot-${Number(seat.label.replace('P', ''))}`, name: '빈 자리', ready: false, isAI: false, isSubstitutedByAI: false, isEmpty: true, isHost: false };
      if (!seat.isAI && seat.id !== params.activeRoomHostId) return { ...seat, ready: false };
      return seat;
    }));
    params.setScreen(finishedRoomId ? 'waitingRoom' : 'lobby');
    params.setCountdown(-1);
    params.setItemPromptTiming(null);
    params.setPendingItemPickup(null);
    params.pendingItemPickupRef.current = null;
    params.setEndGameDialogOpen(false);
    params.setMessage(finishedRoomId ? '방 대기실로 돌아왔습니다.' : '첫 대기화면으로 돌아왔습니다.');
    if (finishedRoomId) void updateRoomStatus(finishedRoomId, 'waiting').catch((error) => console.warn('완주 후 방 대기실 전환에 실패했습니다.', error));
  }, [params]);

  const finishGame = useCallback(() => {
    const finishedRoomId = params.activeRoomId;
    const finishedSeatId = params.localSeatId;
    const shouldSubstituteAsAi = Boolean(finishedRoomId && finishedSeatId && params.screen === 'game' && !params.winner);
    const shouldLeaveFinishedRoom = Boolean(finishedRoomId && finishedSeatId && params.screen === 'game' && params.winner);
    const leavingSeat = shouldSubstituteAsAi ? params.seats.find((seat) => seat.id === finishedSeatId && !seat.isEmpty && !seat.isAI) : undefined;
    if (shouldLeaveFinishedRoom) params.leavingRoomRef.current = true;
    params.hostingRoomUserIdRef.current = '';
    params.activeRoomIdRef.current = '';
    params.confirmedRoomPlayerRef.current = false;
    params.setScreen('lobby');
    params.setActiveRoomTitle('');
    params.setActiveRoomId('');
    params.setActiveRoomHostId('');
    params.setIsRoomHost(false);
    window.localStorage.removeItem(STORAGE_KEYS.activeRoomId);
    window.localStorage.removeItem(STORAGE_KEYS.isRoomHost);
    params.setSeats(createSeats(params.nickname, params.playMode, params.maxPlayers));
    params.setCountdown(-1);
    params.setTurnOrderIds([]);
    params.setGameStartedAt(null);
    params.setItemPromptTiming(null);
    params.setEndGameDialogOpen(false);
    params.setMessage('게임을 나와 로비로 이동했습니다.');
    if (finishedRoomId && finishedSeatId && shouldSubstituteAsAi && leavingSeat) {
      params.addPendingAiSeat(finishedSeatId);
      void updateRoomPlayer(finishedRoomId, finishedSeatId, getSubstitutedRoomPlayerUpdate(leavingSeat))
        .catch((error) => console.warn('게임 종료 후 AI 전환에 실패했습니다.', error))
        .finally(() => params.clearPendingAiSeat(finishedSeatId));
    }
    if (finishedRoomId && finishedSeatId && shouldLeaveFinishedRoom) {
      void removeRoomPlayer(finishedRoomId, finishedSeatId, { preservePlayingSeatAsAi: false })
        .catch((error) => console.warn('완주 후 방 나가기 정리에 실패했습니다.', error))
        .finally(() => { params.leavingRoomRef.current = false; });
    }
  }, [params]);

  const continueRace = useCallback(() => {
    if (!params.activeRoomId) {
      params.setMessage('온라인 방 정보가 없어 이어서 진행할 수 없습니다.');
      return;
    }
    if (!params.canShowContinueRaceButton) {
      params.setMessage('이어서 진행할 수 있는 플레이어가 부족합니다.');
      return;
    }
    const roomId = params.activeRoomId;
    const actionKey = `continue_race:${roomId}:${params.continuationRound + 1}:${Date.now()}`;
    params.addPendingLocalRemoteAction(actionKey, {
      type: 'continue_race',
      actorId: params.localSeatId,
      createdSequence: params.lastAppliedSequenceRef.current,
      createdTurnIndex: params.turnIndex,
      optimisticApplied: false,
    });
    params.enqueueAuthoritativeGameAction(
      roomId,
      { type: 'continue_race', actorId: params.localSeatId, payload: { clientActionId: actionKey } },
      async (result) => {
        if (result.status === 'rejected' || result.status === 'unsupported') {
          params.setMessage(result.reason ?? '이어서 진행 요청을 처리하지 못했습니다.');
          params.removeSettledPendingLocalRemoteAction(actionKey);
          void params.syncLatestAuthoritativeState('서버가 이어서 진행 요청을 거부해 최신 authoritative 상태로 재동기화합니다.', { diagnosticType: 'move_piece' });
          return;
        }
        if ((result.status === 'committed' || result.status === 'duplicate') && result.sequence) {
          const localSequence = params.lastAppliedSequenceRef.current;
          const resultSequence = result.sequence;
          if (resultSequence > localSequence) {
            const sequences = await params.getGameSequencesSince(roomId, getSequenceRefetchAfter(localSequence));
            const latestState = applySequenceEvents({ ...(params.currentSequenceStateRef.current as SequenceStateSnapshot), lastSequence: localSequence }, sequences.filter((sequence) => Number(sequence.sequence ?? 0) <= resultSequence)) ?? undefined;
            if (latestState) await params.replayMissingSequencesThenApply(latestState, localSequence, resultSequence);
          }
          params.acknowledgePendingLocalRemoteAction(actionKey);
        }
        params.setScreen('game');
        params.setMessage('완주하지 못한 플레이어가 이어서 진행합니다.');
        void updateRoomStatus(roomId, 'playing').catch((error) => {
          console.warn('이어서 진행 후 게임중 상태 반영에 실패했습니다.', error);
        });
      },
      (error) => {
        params.setMessage(error instanceof Error ? error.message : '이어서 진행 요청을 처리하지 못했습니다.');
        void params.reconcilePendingLocalRemoteActions({ forceStaleClear: false }).then(() => params.syncLatestAuthoritativeState('이어서 진행 요청 오류로 최신 authoritative 상태로 재동기화합니다.', { diagnosticType: 'move_piece' }));
      },
      () => undefined,
    );
  }, [params]);

  return { returnToWaitingRoom, finishGame, continueRace };
}
