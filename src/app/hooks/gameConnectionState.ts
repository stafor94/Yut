export type GameConnectionStatus = 'online' | 'server-checking' | 'reconnecting' | 'recovering' | 'offline';

export type GameConnectionSnapshot = {
  roomId: string;
  status: GameConnectionStatus;
  lastServerConfirmedAt: number;
  hasPendingWrites: boolean;
};

const listeners = new Set<() => void>();
let snapshot: GameConnectionSnapshot = {
  roomId: '',
  status: 'online',
  lastServerConfirmedAt: 0,
  hasPendingWrites: false,
};

export function getGameConnectionSnapshot() {
  return snapshot;
}

export function subscribeGameConnectionState(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function publishGameConnectionState(next: Partial<GameConnectionSnapshot> & Pick<GameConnectionSnapshot, 'roomId' | 'status'>) {
  snapshot = {
    ...snapshot,
    ...next,
  };
  listeners.forEach((listener) => listener());
}

export const shouldRecoverGameConnectionOnResume = (
  value: GameConnectionSnapshot,
  roomId: string,
  now = Date.now(),
  staleAfterMs = 30_000,
) => Boolean(
  roomId
  && value.roomId === roomId
  && (
    value.status !== 'online'
    || value.lastServerConfirmedAt <= 0
    || now - value.lastServerConfirmedAt >= staleAfterMs
  )
);

export const getGameConnectionPresentation = (value: GameConnectionSnapshot) => {
  switch (value.status) {
    case 'server-checking':
      return { label: '서버 확인 중', tone: 'pending' };
    case 'reconnecting':
      return { label: '재연결 중', tone: 'pending' };
    case 'recovering':
      return { label: '복구 중', tone: 'pending' };
    case 'offline':
      return { label: '오프라인', tone: 'offline' };
    default:
      return { label: '온라인', tone: 'online' };
  }
};
