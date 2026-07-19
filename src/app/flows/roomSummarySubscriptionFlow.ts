import type { MutableRefObject } from 'react';
import type { User } from 'firebase/auth';
import type { ItemTiming } from '../../features/items/logic/items';
import type { PieceCount, PlayMode } from '../appTypes';

type Screen = 'lobby' | 'waitingRoom' | 'game';
type TurnOrderIntro = object;
export type RoomSummary = {
  id: string;
  title: string;
  hostId?: string;
  status: 'waiting' | 'playing' | 'finished';
  maxPlayers: number;
  itemMode: boolean;
  stackedRollMode?: boolean;
  playMode: PlayMode;
  pieceCount?: PieceCount;
  startRequestVersion?: number;
  startRequestId?: string;
  startCountdownStartsAt?: number;
  startCountdownEndsAt?: number;
  startCountdownUntil?: number;
  startStatus?: 'idle' | 'requested' | 'entering' | 'playing' | 'cancelled';
};

type Setter<T> = { bivarianceHack(value: T): void }['bivarianceHack'];
type FunctionalSetter<T> = (value: T | ((previous: T) => T)) => void;

type StartStatus = NonNullable<RoomSummary['startStatus']>;

export type RoomSummarySnapshotRuntime = {
  now: () => number;
  isRoomInGame: (room: RoomSummary) => boolean;
};

export type RoomSummarySnapshotParams = {
  room: RoomSummary | null;
  subscribedRoomId: string;
  currentUser: User | null;
  userRef: MutableRefObject<User | null>;
  hostingRoomUserIdRef: MutableRefObject<string>;
  activeRoomHostIdRef: MutableRefObject<string>;
  pendingStartRequestIdRef: MutableRefObject<string>;
  startRequestInFlightRef: MutableRefObject<boolean>;
  startRequestVersionRef: MutableRefObject<number>;
  startRequestIdRef: MutableRefObject<string>;
  startStatusRef: MutableRefObject<StartStatus>;
  appliedGameStartKeyRef: MutableRefObject<string>;
  screen: Screen;
  winner: string;
  onScreenChange: Setter<Screen>;
  onActiveRoomIdChange: Setter<string>;
  onActiveRoomTitleChange: Setter<string>;
  onActiveRoomHostIdChange: Setter<string>;
  onRoomHostChange: FunctionalSetter<boolean>;
  onPlayModeChange: Setter<PlayMode>;
  onMaxPlayersChange: Setter<2 | 3 | 4>;
  onItemModeChange: Setter<boolean>;
  onStackedRollModeChange: Setter<boolean>;
  onPieceCountChange: Setter<PieceCount>;
  onStartRequestPendingChange: Setter<boolean>;
  onStartRequestVersionChange: Setter<number>;
  onStartRequestIdChange: Setter<string>;
  onStartCountdownStartsAtChange: Setter<number>;
  onStartCountdownEndsAtChange: Setter<number>;
  onStartStatusChange: Setter<StartStatus>;
  onCountdownChange: FunctionalSetter<number>;
  onInitialGameEntryPendingChange: Setter<boolean>;
  onItemPromptTimingChange: Setter<ItemTiming | null>;
  onTurnOrderIntroChange: Setter<TurnOrderIntro | null>;
  onEndGameDialogOpenChange: Setter<boolean>;
  onMessage: Setter<string>;
  runtime: RoomSummarySnapshotRuntime;
};

const resetStartRequestId = (params: Pick<RoomSummarySnapshotParams, 'startRequestIdRef' | 'onStartRequestIdChange'>) => {
  params.startRequestIdRef.current = '';
  params.onStartRequestIdChange('');
};

export function applyRoomSummarySnapshot(params: RoomSummarySnapshotParams) {
  const { room } = params;
  if (!room) {
    params.pendingStartRequestIdRef.current = '';
    params.startRequestInFlightRef.current = false;
    params.onStartRequestPendingChange(false);
    params.hostingRoomUserIdRef.current = '';
    params.activeRoomHostIdRef.current = '';
    params.onScreenChange('lobby');
    params.onActiveRoomIdChange('');
    params.onActiveRoomTitleChange('');
    params.onActiveRoomHostIdChange('');
    params.onRoomHostChange(false);
    params.onCountdownChange(-1);
    resetStartRequestId(params);
    params.onInitialGameEntryPendingChange(false);
    params.appliedGameStartKeyRef.current = '';
    params.onItemPromptTimingChange(null);
    params.onTurnOrderIntroChange(null);
    params.onMessage('방이 종료되어 대기실로 이동했습니다.');
    return;
  }

  const nextHostId = room.hostId ?? '';
  const hostUserId = (params.userRef.current ?? params.currentUser)?.uid ?? params.hostingRoomUserIdRef.current;
  params.activeRoomHostIdRef.current = nextHostId;
  params.onActiveRoomTitleChange(room.title);
  params.onActiveRoomHostIdChange(nextHostId);
  params.onPlayModeChange(room.playMode);
  params.onMaxPlayersChange(room.maxPlayers as 2 | 3 | 4);
  params.onItemModeChange(room.itemMode);
  params.onStackedRollModeChange(Boolean(room.stackedRollMode));
  params.onPieceCountChange((room.pieceCount ?? 4) as PieceCount);
  params.onRoomHostChange((previous) => hostUserId ? room.hostId === hostUserId : previous);

  const snapshotNow = params.runtime.now();
  const nextStartVersion = Number(room.startRequestVersion ?? 0);
  const nextStartRequestId = room.startRequestId ?? '';
  const nextCountdownStartsAt = Number(room.startCountdownStartsAt ?? 0);
  const nextCountdownEndsAt = Number(room.startCountdownEndsAt ?? room.startCountdownUntil ?? 0);
  const nextStartStatus = room.startStatus ?? (nextCountdownEndsAt > snapshotNow ? 'requested' : 'idle');
  const nextStartKey = nextStartVersion && nextStartRequestId ? `${nextStartVersion}:${nextStartRequestId}` : '';

  if (nextStartKey && params.appliedGameStartKeyRef.current && params.appliedGameStartKeyRef.current !== nextStartKey) params.appliedGameStartKeyRef.current = '';
  if (nextStartStatus === 'idle' || nextStartStatus === 'cancelled') {
    params.onInitialGameEntryPendingChange(false);
    params.appliedGameStartKeyRef.current = '';
  }
  if (params.pendingStartRequestIdRef.current && nextStartRequestId === params.pendingStartRequestIdRef.current && nextStartVersion > 0 && (nextStartStatus === 'requested' || nextStartStatus === 'entering' || nextStartStatus === 'playing')) {
    params.pendingStartRequestIdRef.current = '';
    params.startRequestInFlightRef.current = false;
    params.onStartRequestPendingChange(false);
  }

  params.startRequestVersionRef.current = nextStartVersion;
  params.startRequestIdRef.current = nextStartRequestId;
  params.startStatusRef.current = nextStartStatus;
  params.onStartRequestVersionChange(nextStartVersion);
  params.onStartRequestIdChange(nextStartRequestId);
  params.onStartCountdownStartsAtChange(nextCountdownStartsAt);
  params.onStartCountdownEndsAtChange(nextCountdownEndsAt);
  params.onStartStatusChange(nextStartStatus);

  const countdownNow = params.runtime.now();
  if (nextStartStatus === 'requested' && nextCountdownEndsAt > countdownNow) {
    params.onCountdownChange(countdownNow >= nextCountdownStartsAt ? Math.max(1, Math.ceil((nextCountdownEndsAt - countdownNow) / 1000)) : -1);
  } else {
    params.onCountdownChange((current) => current >= 0 ? -1 : current);
  }

  const roomCurrentlyInGame = (nextStartStatus === 'entering' || nextStartStatus === 'playing') || params.runtime.isRoomInGame(room);
  if (roomCurrentlyInGame && nextStartKey && params.appliedGameStartKeyRef.current === nextStartKey) params.onScreenChange('game');

  const startFlowStillActive = nextStartStatus === 'requested' || nextStartStatus === 'entering';
  if (!roomCurrentlyInGame && room.status === 'waiting' && params.screen === 'game' && !params.winner && !startFlowStillActive) {
    params.onScreenChange('waitingRoom');
    params.onCountdownChange(-1);
    resetStartRequestId(params);
    params.onInitialGameEntryPendingChange(false);
    params.appliedGameStartKeyRef.current = '';
    params.onItemPromptTimingChange(null);
    params.onTurnOrderIntroChange(null);
    params.onEndGameDialogOpenChange(false);
    params.onMessage('게임이 종료되어 방 대기실로 돌아왔습니다.');
  }

  if (room.status === 'finished') {
    params.hostingRoomUserIdRef.current = '';
    params.activeRoomHostIdRef.current = '';
    params.onScreenChange('lobby');
    params.onActiveRoomIdChange('');
    params.onActiveRoomTitleChange('');
    params.onActiveRoomHostIdChange('');
    params.onRoomHostChange(false);
    params.onCountdownChange(-1);
    resetStartRequestId(params);
    params.onInitialGameEntryPendingChange(false);
    params.appliedGameStartKeyRef.current = '';
    params.onItemPromptTimingChange(null);
    params.onTurnOrderIntroChange(null);
    params.onEndGameDialogOpenChange(false);
    params.onMessage('게임이 종료되어 첫 대기화면으로 돌아왔습니다.');
  }
}

export function shouldApplyRoomSummarySnapshot(params: { subscribedRoomId: string; currentActiveRoomId: string }) {
  return params.currentActiveRoomId === params.subscribedRoomId;
}
