export const WAITING_ROOM_BACK_EXIT_CONFIRM_MESSAGE = '방을 나가시겠습니까?';
export const GAME_BACK_EXIT_CONFIRM_MESSAGE = '게임을 종료하고 나가시겠습니까?';
export const WAITING_ROOM_BACK_EXIT_EVENT = 'yut:waiting-room-back-exit';

export type BackNavigationExitScreen = 'waitingRoom' | 'game';

export function getBackNavigationExitScreen(message: string): BackNavigationExitScreen | null {
  if (message === WAITING_ROOM_BACK_EXIT_CONFIRM_MESSAGE) return 'waitingRoom';
  if (message === GAME_BACK_EXIT_CONFIRM_MESSAGE) return 'game';
  return null;
}
