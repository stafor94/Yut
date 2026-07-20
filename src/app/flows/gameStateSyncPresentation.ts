export type GameStateSyncPresentation = {
  roomId: string;
  status: 'idle' | 'loading' | 'ready';
};

export const GAME_STATE_SYNC_LOADING_MESSAGE = '최신 게임 상태와 진행 기록을 동기화하는 중입니다...';

let presentation: GameStateSyncPresentation = { roomId: '', status: 'idle' };
const listeners = new Set<() => void>();

const publish = (nextPresentation: GameStateSyncPresentation) => {
  if (presentation.roomId === nextPresentation.roomId && presentation.status === nextPresentation.status) return;
  presentation = nextPresentation;
  listeners.forEach((listener) => listener());
};

export function beginGameStateSync(roomId: string) {
  if (!roomId) {
    clearGameStateSync();
    return;
  }
  publish({ roomId, status: 'loading' });
}

export function completeGameStateSync(roomId: string) {
  if (!roomId || presentation.roomId !== roomId) return false;
  publish({ roomId, status: 'ready' });
  return true;
}

export function clearGameStateSync(roomId = '') {
  if (roomId && presentation.roomId !== roomId) return false;
  publish({ roomId: '', status: 'idle' });
  return true;
}

export function getGameStateSyncPresentation() {
  return presentation;
}

export function subscribeGameStateSyncPresentation(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
