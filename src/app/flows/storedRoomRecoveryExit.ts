import { getRoom, isRoomInGame, removeRoomPlayer } from '../../features/room/services/roomService';
import { auth, signInAsGuest } from '../../services/firebase/firebaseAuth';
import { STORAGE_KEYS } from '../appState';

export const STORED_ROOM_RECOVERY_MESSAGE = '참여 중이던 방을 확인하고 있습니다...';
export const PENDING_STORED_ROOM_EXIT_KEY = 'yut.pendingStoredRoomExit';

const EXIT_RETRY_DELAYS_MS = [0, 800, 1600, 3200] as const;
let pendingStoredRoomExitPromise: Promise<void> | null = null;

const delay = (delayMs: number) => new Promise<void>((resolve) => {
  globalThis.setTimeout(resolve, delayMs);
});

export function requestStoredRoomExitAndReload() {
  if (typeof window === 'undefined') return;
  const roomId = window.localStorage.getItem(STORAGE_KEYS.activeRoomId) ?? '';
  if (roomId) window.localStorage.setItem(PENDING_STORED_ROOM_EXIT_KEY, roomId);
  window.localStorage.removeItem(STORAGE_KEYS.activeRoomId);
  window.localStorage.removeItem(STORAGE_KEYS.isRoomHost);
  window.location.reload();
}

async function settlePendingStoredRoomExit(roomId: string) {
  await auth?.authStateReady();
  const user = auth?.currentUser ?? await signInAsGuest();
  if (!user) throw new Error('방 나가기 처리를 위한 사용자 정보를 확인하지 못했습니다.');

  const room = await getRoom(roomId);
  if (room) {
    await removeRoomPlayer(roomId, user.uid, {
      preservePlayingSeatAsAi: isRoomInGame(room),
    });
  }

  if (window.localStorage.getItem(PENDING_STORED_ROOM_EXIT_KEY) === roomId) {
    window.localStorage.removeItem(PENDING_STORED_ROOM_EXIT_KEY);
  }
}

export function processPendingStoredRoomExit() {
  if (typeof window === 'undefined') return Promise.resolve();
  if (pendingStoredRoomExitPromise) return pendingStoredRoomExitPromise;

  const roomId = window.localStorage.getItem(PENDING_STORED_ROOM_EXIT_KEY) ?? '';
  if (!roomId) return Promise.resolve();

  pendingStoredRoomExitPromise = (async () => {
    let lastError: unknown;
    for (const retryDelayMs of EXIT_RETRY_DELAYS_MS) {
      if (retryDelayMs > 0) await delay(retryDelayMs);
      try {
        await settlePendingStoredRoomExit(roomId);
        return;
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError instanceof Error ? lastError : new Error('참여 중이던 방 나가기 처리에 실패했습니다.');
  })().finally(() => {
    pendingStoredRoomExitPromise = null;
  });

  return pendingStoredRoomExitPromise;
}
