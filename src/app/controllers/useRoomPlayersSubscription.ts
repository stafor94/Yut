import { useEffect, useRef } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { User } from 'firebase/auth';
import { claimRoomHostIfMissing, scheduleEmptyRoomDeletion, subscribeRoomPlayers, type RoomPlayer } from '../../features/room/services/roomService';
import { clearRuntimeAiDifficulties, replaceRuntimeAiDifficulties } from '../../game-core/aiDifficulty';
import { ROOM_PLAYER_MISSING_GRACE_MS } from '../flows/presenceRecovery';
import { makeRoomHostClaimKey, resolveLocalRoomPlayerSnapshot, shouldIgnoreRoomPlayersSnapshot } from '../flows/roomPlayersSubscriptionFlow';
import { preserveLockedGameSeats, seatsFromRoomPlayers, spectatorsFromRoomPlayers, STORAGE_KEYS, type PlayMode, type Screen, type Seat } from '../appState';

interface RoomPlayerAiState { isAI: boolean; isSubstitutedByAI: boolean; isSpectator: boolean; nickname: string }

interface UseRoomPlayersSubscriptionParams {
  activeRoomId: string;
  activeRoomIdRef: MutableRefObject<string>;
  activeRoomHostId: string;
  currentUser: User | null;
  userRef: MutableRefObject<User | null>;
  currentUserId: string;
  playMode: PlayMode;
  maxPlayers: 2 | 3 | 4;
  screen: Screen;
  isRoomManager: boolean;
  canCoordinateOnlineGame: boolean;
  localSeatId: string;
  leavingRoomRef: MutableRefObject<boolean>;
  confirmedRoomPlayerRef: MutableRefObject<boolean>;
  missingRoomPlayerTimerRef: MutableRefObject<number | null>;
  roomHostClaimKeyRef: MutableRefObject<string>;
  pendingAiSeatIdsRef: MutableRefObject<Set<string>>;
  spectatorIdsRef: MutableRefObject<Set<string>>;
  roomPlayerAiStatesRef: MutableRefObject<Map<string, RoomPlayerAiState>>;
  pendingSequenceMetaRef: MutableRefObject<unknown>;
  handlePresencePlayerSnapshot: (player: RoomPlayer | undefined) => void;
  addLogs: (texts: string[]) => void;
  setCoordinatorStateSaveKey: Dispatch<SetStateAction<string>>;
  setPresenceCleanupEligibility: Dispatch<SetStateAction<{ roomId: string; eligible: boolean }>>;
  setSeats: Dispatch<SetStateAction<Seat[]>>;
  setSpectators: Dispatch<SetStateAction<Seat[]>>;
  setScreen: Dispatch<SetStateAction<Screen>>;
  setActiveRoomId: Dispatch<SetStateAction<string>>;
  setActiveRoomTitle: Dispatch<SetStateAction<string>>;
  setActiveRoomHostId: Dispatch<SetStateAction<string>>;
  setIsRoomHost: Dispatch<SetStateAction<boolean>>;
  setCountdown: Dispatch<SetStateAction<number>>;
  setMessage: Dispatch<SetStateAction<string>>;
  setRoomNoticeDialog: Dispatch<SetStateAction<{ title: string; message: string } | null>>;
}

export function useRoomPlayersSubscription(params: UseRoomPlayersSubscriptionParams) {
  const { activeRoomId, activeRoomIdRef, activeRoomHostId, currentUser, userRef, playMode, maxPlayers, screen, isRoomManager, canCoordinateOnlineGame, localSeatId, leavingRoomRef, confirmedRoomPlayerRef, missingRoomPlayerTimerRef, roomHostClaimKeyRef, pendingAiSeatIdsRef, spectatorIdsRef, roomPlayerAiStatesRef, pendingSequenceMetaRef, handlePresencePlayerSnapshot, addLogs, setCoordinatorStateSaveKey, setPresenceCleanupEligibility, setSeats, setSpectators, setScreen, setActiveRoomId, setActiveRoomTitle, setActiveRoomHostId, setIsRoomHost, setCountdown, setMessage, setRoomNoticeDialog } = params;
  const addLogsRef = useRef(addLogs);
  const handlePresencePlayerSnapshotRef = useRef(handlePresencePlayerSnapshot);
  addLogsRef.current = addLogs;
  handlePresencePlayerSnapshotRef.current = handlePresencePlayerSnapshot;

  useEffect(() => {
    if (!activeRoomId) return undefined;
    spectatorIdsRef.current = new Set();
    roomPlayerAiStatesRef.current = new Map();
    const unsubscribe = subscribeRoomPlayers(activeRoomId, (players) => {
      if (shouldIgnoreRoomPlayersSnapshot(activeRoomId, activeRoomIdRef.current)) return;
      replaceRuntimeAiDifficulties(players.filter((player) => player.isAI || player.isSubstitutedByAI));
      const nextSeats = seatsFromRoomPlayers(players, playMode, maxPlayers, activeRoomHostId);
      const currentUserId = (userRef.current ?? currentUser)?.uid;
      const { localPresencePlayer, hasCurrentUserInSnapshot, presenceCleanupEligible: nextPresenceCleanupEligible } = resolveLocalRoomPlayerSnapshot(players, currentUserId ?? '');
      setPresenceCleanupEligibility((current) => current.roomId === activeRoomId && current.eligible === nextPresenceCleanupEligible ? current : { roomId: activeRoomId, eligible: nextPresenceCleanupEligible });
      if (screen === 'waitingRoom' && !isRoomManager && confirmedRoomPlayerRef.current && players.length === 0) {
        confirmedRoomPlayerRef.current = false;
        activeRoomIdRef.current = '';
        if (missingRoomPlayerTimerRef.current !== null) { window.clearTimeout(missingRoomPlayerTimerRef.current); missingRoomPlayerTimerRef.current = null; }
        window.localStorage.removeItem(STORAGE_KEYS.activeRoomId);
        window.localStorage.removeItem(STORAGE_KEYS.isRoomHost);
        setScreen('lobby'); setActiveRoomId(''); setActiveRoomTitle(''); setActiveRoomHostId(''); setIsRoomHost(false); setCountdown(-1);
        setMessage('방장이 방을 나가 방이 종료되었습니다.');
        setRoomNoticeDialog({ title: '방장이 방을 나갔습니다.', message: '방이 종료되어 로비로 이동했습니다.' });
        return;
      }
      if (hasCurrentUserInSnapshot) {
        confirmedRoomPlayerRef.current = true;
        if (missingRoomPlayerTimerRef.current !== null) { window.clearTimeout(missingRoomPlayerTimerRef.current); missingRoomPlayerTimerRef.current = null; }
      }
      if (currentUserId && !leavingRoomRef.current && !isRoomManager && screen === 'waitingRoom' && confirmedRoomPlayerRef.current && !hasCurrentUserInSnapshot && missingRoomPlayerTimerRef.current === null) {
        const missingRoomId = activeRoomId; const missingUserId = currentUserId;
        missingRoomPlayerTimerRef.current = window.setTimeout(() => {
          missingRoomPlayerTimerRef.current = null;
          if (activeRoomIdRef.current !== missingRoomId || leavingRoomRef.current || (userRef.current ?? currentUser)?.uid !== missingUserId || !confirmedRoomPlayerRef.current) return;
          confirmedRoomPlayerRef.current = false;
          setScreen('lobby'); setActiveRoomId(''); setActiveRoomTitle(''); setIsRoomHost(false); setCountdown(-1);
          setMessage('방장에게 강퇴당했습니다.'); setRoomNoticeDialog({ title: '방장에게 강퇴당했습니다.', message: '로비로 이동했습니다.' });
        }, ROOM_PLAYER_MISSING_GRACE_MS);
      }
      handlePresencePlayerSnapshotRef.current(localPresencePlayer);
      const currentHostPlayer = activeRoomHostId ? players.find((player) => player.id === activeRoomHostId) : undefined;
      const hasActiveHumanHost = Boolean(currentHostPlayer && !currentHostPlayer.isAI && !currentHostPlayer.isSpectator);
      const localHumanPlayer = currentUserId ? players.find((player) => player.id === currentUserId && !player.isAI && !player.isSpectator) : undefined;
      if (activeRoomId && screen === 'waitingRoom' && localHumanPlayer && !hasActiveHumanHost) {
        const candidateHostId = currentUserId; if (!candidateHostId) return;
        const claimKey = makeRoomHostClaimKey(activeRoomId, activeRoomHostId, currentUserId);
        if (roomHostClaimKeyRef.current !== claimKey) {
          roomHostClaimKeyRef.current = claimKey;
          void claimRoomHostIfMissing(activeRoomId, candidateHostId).then((claimedHostId) => {
            if (claimedHostId !== candidateHostId) return;
            setActiveRoomHostId(claimedHostId); setIsRoomHost(true); setMessage('방장이 없어 방장 권한을 이어받았습니다.');
          }).catch((error) => { roomHostClaimKeyRef.current = ''; console.warn('방장 승계에 실패했습니다.', error); });
        }
      }
      setSeats((currentSeats) => {
        const seatsWithPendingAI = nextSeats.map((nextSeat) => {
          if (!pendingAiSeatIdsRef.current.has(nextSeat.id) || !nextSeat.isEmpty) return nextSeat;
          const optimisticAISeat = currentSeats.find((seat) => seat.id === nextSeat.id && seat.isAI);
          return optimisticAISeat ? { ...nextSeat, ...optimisticAISeat, isEmpty: false, ready: true, isAI: true } : nextSeat;
        });
        if (screen === 'game') return preserveLockedGameSeats(currentSeats, seatsWithPendingAI);
        if (!currentUserId || isRoomManager || screen !== 'waitingRoom' || hasCurrentUserInSnapshot) return seatsWithPendingAI;
        if (seatsWithPendingAI.some((seat) => seat.id === currentUserId && !seat.isEmpty && !seat.isAI)) return seatsWithPendingAI;
        const optimisticSeat = currentSeats.find((seat) => seat.id === currentUserId && !seat.isEmpty && !seat.isAI);
        if (!optimisticSeat) return seatsWithPendingAI;
        return seatsWithPendingAI.map((seat) => seat.label === optimisticSeat.label ? { ...seat, ...optimisticSeat, isHost: false, isEmpty: false } : seat);
      });
      const nextSpectators = spectatorsFromRoomPlayers(players);
      if (canCoordinateOnlineGame && screen === 'game') {
        const previousIds = spectatorIdsRef.current; const previousAiStates = roomPlayerAiStatesRef.current; const systemLogTexts: string[] = [];
        nextSpectators.forEach((spectator) => { if (!previousIds.has(spectator.id)) systemLogTexts.push(`${spectator.name}님이 관전자로 입장했습니다.`); });
        players.forEach((player) => { if (player.isSpectator) return; const previous = previousAiStates.get(player.id); if (!previous || previous.isSpectator) return; if (!previous.isAI && player.isAI && player.isSubstitutedByAI) systemLogTexts.push(`${previous.nickname || player.nickname}님이 나갔습니다. AI가 이어서 플레이합니다.`); if (previous.isSubstitutedByAI && !player.isAI) systemLogTexts.push(`${player.nickname}님이 돌아왔습니다. 다시 유저가 플레이합니다.`); });
        if (systemLogTexts.length) { addLogsRef.current(systemLogTexts); pendingSequenceMetaRef.current = { type: 'state_snapshot', actorId: localSeatId, clientMutationId: `player_presence:${activeRoomId}:${Date.now()}`, payload: { event: 'player_presence_changed', count: systemLogTexts.length } }; setCoordinatorStateSaveKey((current) => current || `player_presence:${activeRoomId}:${Date.now()}`); }
      }
      spectatorIdsRef.current = new Set(nextSpectators.map((spectator) => spectator.id));
      roomPlayerAiStatesRef.current = new Map(players.map((player) => [player.id, { isAI: Boolean(player.isAI), isSubstitutedByAI: Boolean(player.isSubstitutedByAI), isSpectator: Boolean(player.isSpectator), nickname: player.nickname }]));
      setSpectators(nextSpectators);
      if (!players.length) void scheduleEmptyRoomDeletion(activeRoomId);
    });
    return () => { if (missingRoomPlayerTimerRef.current !== null) { window.clearTimeout(missingRoomPlayerTimerRef.current); missingRoomPlayerTimerRef.current = null; } clearRuntimeAiDifficulties(); unsubscribe(); };
  }, [activeRoomHostId, activeRoomId, activeRoomIdRef, canCoordinateOnlineGame, confirmedRoomPlayerRef, currentUser, isRoomManager, leavingRoomRef, localSeatId, maxPlayers, missingRoomPlayerTimerRef, pendingAiSeatIdsRef, pendingSequenceMetaRef, playMode, roomHostClaimKeyRef, roomPlayerAiStatesRef, screen, setActiveRoomHostId, setActiveRoomId, setActiveRoomTitle, setCountdown, setCoordinatorStateSaveKey, setIsRoomHost, setMessage, setPresenceCleanupEligibility, setRoomNoticeDialog, setScreen, setSeats, setSpectators, spectatorIdsRef, userRef]);
}
