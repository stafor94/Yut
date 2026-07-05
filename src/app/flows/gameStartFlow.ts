const START_COUNTDOWN_DELAY_MS = 1000;
const START_COUNTDOWN_MS = 5000;

type GetStartGameBlockMessageInput = {
  activeRoomId: string;
  allReady: boolean;
  canManageRoom: boolean;
  playMode: 'individual' | 'team';
  teamBalanced: boolean;
};

export function getStartGameBlockMessage({ activeRoomId, allReady, canManageRoom, playMode, teamBalanced }: GetStartGameBlockMessageInput) {
  if (!activeRoomId) return '온라인 방 정보가 없어 게임을 시작할 수 없습니다.';
  if (!canManageRoom) return '방장 정보를 확인하는 중입니다. 잠시 뒤 다시 시도해주세요.';
  if (!allReady) return playMode === 'team' && !teamBalanced ? '팀전은 4인전만 가능하며 청팀 2명, 홍팀 2명이어야 시작할 수 있습니다.' : '아직 준비하지 않은 플레이어가 있습니다.';
  return '';
}

export function createStartCountdownWindow(requestedAt: number, startRequestVersion: number) {
  return {
    localVersion: startRequestVersion + 1,
    startsAt: requestedAt + START_COUNTDOWN_DELAY_MS,
    endsAt: requestedAt + START_COUNTDOWN_DELAY_MS + START_COUNTDOWN_MS,
  };
}
