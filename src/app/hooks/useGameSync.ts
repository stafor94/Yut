import { useEffect, useRef, type MutableRefObject } from 'react';
import type { Unsubscribe } from 'firebase/firestore';
import {
  getLatestGameState,
  removeRoomPlayer,
  subscribeGameState,
  subscribeRoom,
  subscribeRoomPlayers,
  type RoomPlayer,
  type RoomSummary,
  type SyncedGameState,
} from '../../features/room/services/roomService';
import { activatePreparedRoomGame, prepareRoomGameState } from '../../features/room/services/roomGamePreparationService';
import { auth } from '../../services/firebase/firebaseAuth';
import { STORAGE_KEYS, type SequenceStateSnapshot } from '../appState';
import {
  buildPreparedRoomGameState,
  getGameStartCoordinatorPlayerId,
  getRoomStartPreparationAt,
  getRoomStartPreparationMutationId,
  getRoomStartRequestKey,
} from '../flows/gameStartPreparation';
import {
  createGameSyncSubscriptionController,
  type GameSyncRuntime,
  type GameSyncSubscriptionController,
} from './gameSyncSubscription';
import {
  notifySequenceRecoveryProgress,
  SEQUENCE_RECOVERY_FATAL_EVENT,
  SEQUENCE_RECOVERY_HARD_EVENT,
  SEQUENCE_RECOVERY_SOFT_EVENT,
  setSequenceRecoveryRoomContext,
  type SequenceRecoveryEscalationDetail,
} from './sequenceRecoveryWatchdog';

const SEQUENCE_RECOVERY_FETCH_TIMEOUT_MS = 5000;
const GAME_PREPARATION_RETRY_MS = 150;
const GAME_ACTIVATION_RETRY_MS = 250;
const GAME_ACTIVATION_RETRY_LIMIT = 20;

function getLatestGameStateWithTimeout(roomId: string) {
  return new Promise<SyncedGameState | null>((resolve) => {
    let settled = false;
    const finish = (state: SyncedGameState | null) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      resolve(state);
    };
    const timer = window.setTimeout(() => finish(null), SEQUENCE_RECOVERY_FETCH_TIMEOUT_MS);
    void getLatestGameState(roomId).then(finish).catch(() => finish(null));
  });
}

export function useGameSyncDebugState(diagnosticState: Record<string, unknown>) {
  useEffect(() => {
    (window as typeof window & { __YUT_DEBUG_STATE__?: Record<string, unknown> }).__YUT_DEBUG_STATE__ = diagnosticState;
  }, [diagnosticState]);
}

type GameSyncSubscriptionParams = {
  activeRoomId: string;
  lastAppliedSequenceRef: MutableRefObject<number>;
  lastAppliedStateVersionRef: MutableRefObject<number>;
  applyingSyncedStateRef: MutableRefObject<boolean>;
  replayMissingSequencesThenApply: (finalState: SequenceStateSnapshot, localSequence: number, remoteSequence: number) => Promise<void>;
  applySyncedStateSnapshot: (state: SequenceStateSnapshot) => void;
  enqueueAuthoritativeResultApplication: (applyResult: () => Promise<void> | void) => Promise<void | null>;
  onSnapshotReceived?: (state: SequenceStateSnapshot) => void;
  subscribe?: (roomId: string, callback: (state: SyncedGameState | null) => void) => Unsubscribe;
};

export function useGameSyncSubscription({ activeRoomId, lastAppliedSequenceRef, lastAppliedStateVersionRef, applyingSyncedStateRef, replayMissingSequencesThenApply, applySyncedStateSnapshot, enqueueAuthoritativeResultApplication, onSnapshotReceived, subscribe = subscribeGameState }: GameSyncSubscriptionParams) {
  const subscribeRef = useRef(subscribe);
  subscribeRef.current = subscribe;
  const activeRoomIdRef = useRef(activeRoomId);
  activeRoomIdRef.current = activeRoomId;
  const previousRoomIdRef = useRef('');
  const latestGameStateActiveRef = useRef(false);
  const fatalRecoveryHandledRef = useRef(false);
  const escalationRecoveryRef = useRef<Promise<boolean> | null>(null);
  const recoverLatestStateRef = useRef<(roomId: string) => Promise<boolean>>(async () => false);
  const syncRecoveryRoomContextRef = useRef<() => void>(() => undefined);

  const controllerRef = useRef<GameSyncSubscriptionController<SyncedGameState> | null>(null);
  if (!controllerRef.current) controllerRef.current = createGameSyncSubscriptionController<SyncedGameState>();

  syncRecoveryRoomContextRef.current = () => {
    const roomId = activeRoomIdRef.current;
    const gameScreenActive = Boolean(document.querySelector('[data-testid="app-shell"].screen-game'));
    setSequenceRecoveryRoomContext(roomId, Boolean(roomId && latestGameStateActiveRef.current && gameScreenActive));
  };

  recoverLatestStateRef.current = (roomId: string) => {
    if (escalationRecoveryRef.current) return escalationRecoveryRef.current;
    const recovery = (async () => {
      if (!roomId || activeRoomIdRef.current !== roomId) return false;
      const latestState = await getLatestGameStateWithTimeout(roomId);
      if (!latestState || activeRoomIdRef.current !== roomId) return false;
      const localSequence = lastAppliedSequenceRef.current;
      const remoteSequence = Number(latestState.lastSequence ?? 0);
      if (!Number.isFinite(remoteSequence) || remoteSequence <= localSequence) return false;
      await replayMissingSequencesThenApply(latestState as SequenceStateSnapshot, localSequence, remoteSequence);
      notifySequenceRecoveryProgress(roomId, remoteSequence);
      return true;
    })().catch(() => false).finally(() => {
      escalationRecoveryRef.current = null;
    });
    escalationRecoveryRef.current = recovery;
    return recovery;
  };

  const runtimeRef = useRef<GameSyncRuntime<SyncedGameState> | null>(null);
  runtimeRef.current = {
    activeRoomId,
    lastAppliedSequenceRef,
    lastAppliedStateVersionRef,
    applyingSyncedStateRef,
    replayMissingSequencesThenApply: (state, localSequence, remoteSequence) => replayMissingSequencesThenApply(state as SequenceStateSnapshot, localSequence, remoteSequence),
    applySyncedStateSnapshot: (state) => applySyncedStateSnapshot(state as SequenceStateSnapshot),
    enqueueAuthoritativeResultApplication,
    onSnapshotReceived: (state) => {
      latestGameStateActiveRef.current = !state.winner;
      syncRecoveryRoomContextRef.current();
      onSnapshotReceived?.(state as SequenceStateSnapshot);
    },
    scheduleApplyingReset: (reset) => { window.setTimeout(reset, 0); },
  };
  controllerRef.current.updateRuntime(runtimeRef.current);

  useEffect(() => {
    if (!activeRoomId) return undefined;
    let disposed = false;
    let room: RoomSummary | null = null;
    let players: RoomPlayer[] = [];
    let scheduledKey = '';
    let preparationStartedKey = '';
    let activationStartedKey = '';
    let preparationTimer: number | null = null;
    let activationTimer: number | null = null;

    const clearPreparationTimer = () => {
      if (preparationTimer === null) return;
      window.clearTimeout(preparationTimer);
      preparationTimer = null;
    };
    const clearActivationTimer = () => {
      if (activationTimer === null) return;
      window.clearTimeout(activationTimer);
      activationTimer = null;
    };
    const currentRequestMatches = (key: string) => {
      if (!room || room.startStatus !== 'requested' || room.status !== 'waiting') return false;
      return getRoomStartRequestKey(activeRoomId, Number(room.startRequestVersion ?? 0), String(room.startRequestId ?? '')) === key;
    };

    const runPreparation = async (key: string, attempt = 0): Promise<void> => {
      if (disposed || !room || !currentRequestMatches(key)) return;
      const coordinatorPlayerId = getGameStartCoordinatorPlayerId(players);
      if (!coordinatorPlayerId || auth?.currentUser?.uid !== coordinatorPlayerId) return;
      const startRequestVersion = Number(room.startRequestVersion ?? 0);
      const startRequestId = String(room.startRequestId ?? '');
      const countdownEndsAt = Number(room.startCountdownEndsAt ?? room.startCountdownUntil ?? 0);
      const initializedAt = Date.now();
      const preparedState = buildPreparedRoomGameState({
        roomId: activeRoomId,
        room,
        players,
        startRequestVersion,
        startRequestId,
        countdownEndsAt,
      });
      const result = await prepareRoomGameState(activeRoomId, preparedState, {
        actorId: coordinatorPlayerId,
        startRequestVersion,
        startRequestId,
        initializedAt,
        clientMutationId: getRoomStartPreparationMutationId(activeRoomId, startRequestVersion, startRequestId),
      }).catch(() => ({ status: 'unavailable' as const }));
      if (disposed || !currentRequestMatches(key)) return;
      if ((result.status === 'sequence_mismatch' || result.status === 'unavailable') && attempt < 3 && Date.now() < countdownEndsAt) {
        preparationTimer = window.setTimeout(() => { void runPreparation(key, attempt + 1); }, GAME_PREPARATION_RETRY_MS);
      }
    };

    const runActivation = async (key: string, attempt = 0): Promise<void> => {
      if (disposed || !room || !currentRequestMatches(key)) return;
      const startRequestVersion = Number(room.startRequestVersion ?? 0);
      const startRequestId = String(room.startRequestId ?? '');
      const activated = await activatePreparedRoomGame(activeRoomId, { startRequestVersion, startRequestId }).catch(() => false);
      if (activated || disposed || !currentRequestMatches(key) || attempt >= GAME_ACTIVATION_RETRY_LIMIT) return;
      activationTimer = window.setTimeout(() => { void runActivation(key, attempt + 1); }, GAME_ACTIVATION_RETRY_MS);
    };

    const scheduleCurrentRequest = () => {
      clearPreparationTimer();
      clearActivationTimer();
      if (!room || room.status !== 'waiting' || room.startStatus !== 'requested') return;
      const startRequestVersion = Number(room.startRequestVersion ?? 0);
      const startRequestId = String(room.startRequestId ?? '');
      const countdownEndsAt = Number(room.startCountdownEndsAt ?? room.startCountdownUntil ?? 0);
      const key = getRoomStartRequestKey(activeRoomId, startRequestVersion, startRequestId);
      if (!key || countdownEndsAt <= 0) return;
      if (scheduledKey !== key) {
        scheduledKey = key;
        preparationStartedKey = '';
        activationStartedKey = '';
      }

      const coordinatorPlayerId = getGameStartCoordinatorPlayerId(players);
      if (coordinatorPlayerId && auth?.currentUser?.uid === coordinatorPlayerId && preparationStartedKey !== key) {
        const preparationDelay = Math.max(0, getRoomStartPreparationAt(countdownEndsAt) - Date.now());
        preparationTimer = window.setTimeout(() => {
          preparationStartedKey = key;
          void runPreparation(key);
        }, preparationDelay);
      }
      if (activationStartedKey !== key) {
        const activationDelay = Math.max(0, countdownEndsAt - Date.now());
        activationTimer = window.setTimeout(() => {
          activationStartedKey = key;
          void runActivation(key);
        }, activationDelay);
      }
    };

    const unsubscribeRoom = subscribeRoom(activeRoomId, (nextRoom) => {
      room = nextRoom;
      scheduleCurrentRequest();
    });
    const unsubscribePlayers = subscribeRoomPlayers(activeRoomId, (nextPlayers) => {
      players = nextPlayers;
      scheduleCurrentRequest();
    });

    return () => {
      disposed = true;
      clearPreparationTimer();
      clearActivationTimer();
      unsubscribeRoom();
      unsubscribePlayers();
    };
  }, [activeRoomId]);

  useEffect(() => {
    const observer = new MutationObserver(() => syncRecoveryRoomContextRef.current());
    observer.observe(document.body, { attributes: true, attributeFilter: ['class'], subtree: true });
    syncRecoveryRoomContextRef.current();
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const previousRoomId = previousRoomIdRef.current;
    if (previousRoomId && previousRoomId !== activeRoomId) {
      latestGameStateActiveRef.current = false;
      setSequenceRecoveryRoomContext(previousRoomId, false);
    }
    previousRoomIdRef.current = activeRoomId;
    const controller = controllerRef.current;
    const runtime = runtimeRef.current;
    if (!controller || !runtime) return;
    fatalRecoveryHandledRef.current = false;
    controller.updateRuntime(runtime);
    controller.syncRoom(activeRoomId, subscribeRef.current);
    if (!activeRoomId) {
      latestGameStateActiveRef.current = false;
      setSequenceRecoveryRoomContext(previousRoomId, false);
    }
    syncRecoveryRoomContextRef.current();
  }, [activeRoomId]);

  useEffect(() => {
    const getDetail = (event: Event) => (event as CustomEvent<SequenceRecoveryEscalationDetail>).detail;
    const getActiveRecoveryRoomId = (event: Event) => {
      const roomId = getDetail(event)?.roomId ?? '';
      return roomId && activeRoomIdRef.current === roomId ? roomId : '';
    };
    const handleSoftRecovery = (event: Event) => {
      const roomId = getActiveRecoveryRoomId(event);
      if (!roomId) return;
      void recoverLatestStateRef.current(roomId);
    };
    const handleHardRecovery = (event: Event) => {
      const roomId = getActiveRecoveryRoomId(event);
      if (!roomId) return;
      const controller = controllerRef.current;
      if (controller) {
        controller.syncRoom('', subscribeRef.current);
        const runtime = runtimeRef.current;
        if (runtime) controller.updateRuntime(runtime);
        controller.syncRoom(roomId, subscribeRef.current);
      }
      void recoverLatestStateRef.current(roomId);
    };
    const handleFatalRecovery = (event: Event) => {
      const roomId = getActiveRecoveryRoomId(event);
      if (!roomId || fatalRecoveryHandledRef.current) return;
      fatalRecoveryHandledRef.current = true;
      void recoverLatestStateRef.current(roomId).then((recovered) => {
        if (recovered || activeRoomIdRef.current !== roomId) {
          fatalRecoveryHandledRef.current = false;
          return;
        }
        controllerRef.current?.syncRoom('', subscribeRef.current);
        latestGameStateActiveRef.current = false;
        setSequenceRecoveryRoomContext(roomId, false);
        let finalized = false;
        const finalizeExit = () => {
          if (finalized) return;
          finalized = true;
          window.localStorage.removeItem(STORAGE_KEYS.activeRoomId);
          window.localStorage.removeItem(STORAGE_KEYS.isRoomHost);
          window.alert('2분 동안 서버의 게임 진행을 확인하지 못해 게임을 종료하고 로비로 이동합니다.');
          window.location.reload();
        };
        const fallbackTimer = window.setTimeout(finalizeExit, 2000);
        const userId = auth?.currentUser?.uid ?? '';
        const leaveRequest = userId ? removeRoomPlayer(roomId, userId) : Promise.resolve();
        void leaveRequest.catch(() => undefined).finally(() => {
          window.clearTimeout(fallbackTimer);
          finalizeExit();
        });
      });
    };

    window.addEventListener(SEQUENCE_RECOVERY_SOFT_EVENT, handleSoftRecovery);
    window.addEventListener(SEQUENCE_RECOVERY_HARD_EVENT, handleHardRecovery);
    window.addEventListener(SEQUENCE_RECOVERY_FATAL_EVENT, handleFatalRecovery);
    return () => {
      window.removeEventListener(SEQUENCE_RECOVERY_SOFT_EVENT, handleSoftRecovery);
      window.removeEventListener(SEQUENCE_RECOVERY_HARD_EVENT, handleHardRecovery);
      window.removeEventListener(SEQUENCE_RECOVERY_FATAL_EVENT, handleFatalRecovery);
    };
  }, []);

  useEffect(() => () => {
    const roomId = previousRoomIdRef.current;
    latestGameStateActiveRef.current = false;
    if (roomId) setSequenceRecoveryRoomContext(roomId, false);
    controllerRef.current?.dispose();
  }, []);
}
