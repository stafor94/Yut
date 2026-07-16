import { useEffect } from 'react';
import {
  subscribeGameState,
  subscribeRoomPlayers,
  type RoomPlayer,
  type SyncedGameState,
} from '../../features/room/services/roomService';
import {
  DEFAULT_AI_DIFFICULTY,
  getEffectiveAiDifficulty,
  setCurrentAiRollDifficulty,
} from '../../game-core/aiDifficulty';
import { STORAGE_KEYS } from '../appState';

const ACTIVE_ROOM_CHECK_MS = 500;

type RoomPlayerWithDifficulty = RoomPlayer & { aiDifficulty?: unknown };

export function resolveActiveAiDifficulty(players: RoomPlayer[], state: SyncedGameState | null) {
  const turnOrderIds = state?.turnOrderIds ?? [];
  if (!turnOrderIds.length) return DEFAULT_AI_DIFFICULTY;
  const activeSeatId = turnOrderIds[Math.max(0, Number(state?.turnIndex ?? 0)) % turnOrderIds.length];
  const player = players.find((candidate) => candidate.id === activeSeatId) as RoomPlayerWithDifficulty | undefined;
  if (!player || (!player.isAI && !player.isSubstitutedByAI)) return DEFAULT_AI_DIFFICULTY;
  return getEffectiveAiDifficulty(player);
}

export function AiDifficultyRuntimeBridge() {
  useEffect(() => {
    let activeRoomId = '';
    let players: RoomPlayer[] = [];
    let gameState: SyncedGameState | null = null;
    let unsubscribePlayers: () => void = () => undefined;
    let unsubscribeGameState: () => void = () => undefined;

    const applyDifficulty = () => {
      setCurrentAiRollDifficulty(resolveActiveAiDifficulty(players, gameState));
    };

    const bindRoom = (roomId: string) => {
      unsubscribePlayers();
      unsubscribeGameState();
      players = [];
      gameState = null;
      setCurrentAiRollDifficulty(DEFAULT_AI_DIFFICULTY);
      activeRoomId = roomId;
      if (!roomId) return;
      unsubscribePlayers = subscribeRoomPlayers(roomId, (nextPlayers) => {
        players = nextPlayers;
        applyDifficulty();
      });
      unsubscribeGameState = subscribeGameState(roomId, (nextState) => {
        gameState = nextState;
        applyDifficulty();
      });
    };

    const syncActiveRoom = () => {
      const nextRoomId = window.localStorage.getItem(STORAGE_KEYS.activeRoomId) ?? '';
      if (nextRoomId !== activeRoomId) bindRoom(nextRoomId);
    };

    syncActiveRoom();
    const interval = window.setInterval(syncActiveRoom, ACTIVE_ROOM_CHECK_MS);
    return () => {
      window.clearInterval(interval);
      unsubscribePlayers();
      unsubscribeGameState();
      setCurrentAiRollDifficulty(DEFAULT_AI_DIFFICULTY);
    };
  }, []);

  return null;
}
