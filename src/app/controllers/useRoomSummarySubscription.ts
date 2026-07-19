import { useEffect } from 'react';
import type { MutableRefObject } from 'react';
import type { User } from 'firebase/auth';
import { isRoomInGame, subscribeRoom } from '../../features/room/services/roomService';
import type { ItemTiming } from '../../features/items/logic/items';
import type { PieceCount, PlayMode } from '../appTypes';
import type { Screen, TurnOrderIntro } from '../appState';
import { applyRoomSummarySnapshot, shouldApplyRoomSummarySnapshot, type RoomSummary } from '../flows/roomSummarySubscriptionFlow';

type StartStatus = NonNullable<RoomSummary['startStatus']>;

type Setter<T> = { bivarianceHack(value: T): void }['bivarianceHack'];
type FunctionalSetter<T> = (value: T | ((previous: T) => T)) => void;

type UseRoomSummarySubscriptionParams = {
  activeRoomId: string;
  activeRoomIdRef: MutableRefObject<string>;
  currentUser: User | null;
  userRef: MutableRefObject<User | null>;
  hostingRoomUserIdRef: MutableRefObject<string>;
  activeRoomHostIdRef: MutableRefObject<string>;
  screen: Screen;
  winner: string;
  pendingStartRequestIdRef: MutableRefObject<string>;
  startRequestInFlightRef: MutableRefObject<boolean>;
  startRequestVersionRef: MutableRefObject<number>;
  startRequestIdRef: MutableRefObject<string>;
  startStatusRef: MutableRefObject<StartStatus>;
  appliedGameStartKeyRef: MutableRefObject<string>;
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
};

export function useRoomSummarySubscription(params: UseRoomSummarySubscriptionParams) {
  useEffect(() => {
    if (!params.activeRoomId) return undefined;
    const subscribedRoomId = params.activeRoomId;
    return subscribeRoom(subscribedRoomId, (room: Parameters<typeof applyRoomSummarySnapshot>[0]['room']) => {
      if (!shouldApplyRoomSummarySnapshot({ subscribedRoomId, currentActiveRoomId: params.activeRoomIdRef.current })) return;
      applyRoomSummarySnapshot({
        ...params,
        room,
        subscribedRoomId,
        runtime: { now: Date.now, isRoomInGame },
      });
    });
  }, [
    params.activeRoomId,
    params.activeRoomIdRef,
    params.activeRoomHostIdRef,
    params.appliedGameStartKeyRef,
    params.currentUser,
    params.hostingRoomUserIdRef,
    params.onActiveRoomHostIdChange,
    params.onActiveRoomIdChange,
    params.onActiveRoomTitleChange,
    params.onCountdownChange,
    params.onEndGameDialogOpenChange,
    params.onInitialGameEntryPendingChange,
    params.onItemModeChange,
    params.onItemPromptTimingChange,
    params.onMaxPlayersChange,
    params.onMessage,
    params.onPieceCountChange,
    params.onPlayModeChange,
    params.onRoomHostChange,
    params.onScreenChange,
    params.onStackedRollModeChange,
    params.onStartCountdownEndsAtChange,
    params.onStartCountdownStartsAtChange,
    params.onStartRequestIdChange,
    params.onStartRequestPendingChange,
    params.onStartRequestVersionChange,
    params.onStartStatusChange,
    params.onTurnOrderIntroChange,
    params.pendingStartRequestIdRef,
    params.screen,
    params.startRequestIdRef,
    params.startRequestInFlightRef,
    params.startRequestVersionRef,
    params.startStatusRef,
    params.userRef,
    params.winner,
  ]);
}
