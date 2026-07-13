type GetStartGameBlockMessageInput = {
  activeRoomId: string;
  allReady: boolean;
  canManageRoom: boolean;
  playMode: 'individual' | 'team';
  teamBalanced: boolean;
};

type GetWaitingRoomStartHintInput = {
  initialGameEntryPending: boolean;
  roomInGame: boolean;
  startFlowBusy: boolean;
  allReady: boolean;
  playMode: 'individual' | 'team';
  teamBalanced: boolean;
  teamCounts: Record<'청팀' | '홍팀', number>;
  readyMissingCount: number;
};

export function getStartGameBlockMessage({ activeRoomId, allReady, canManageRoom, playMode, teamBalanced }: GetStartGameBlockMessageInput) {
  if (!activeRoomId) return '온라인 방 정보가 없어 게임을 시작할 수 없습니다.';
  if (!canManageRoom) return '방장 정보를 확인하는 중입니다. 잠시 뒤 다시 시도해주세요.';
  if (!allReady) return playMode === 'team' && !teamBalanced ? '팀전은 4인전만 가능하며 청팀 2명, 홍팀 2명이어야 시작할 수 있습니다.' : '아직 준비하지 않은 플레이어가 있습니다.';
  return '';
}

export function getWaitingRoomStartHint({
  initialGameEntryPending,
  roomInGame,
  startFlowBusy,
  allReady,
  playMode,
  teamBalanced,
  teamCounts,
  readyMissingCount,
}: GetWaitingRoomStartHintInput) {
  if (initialGameEntryPending) return '게임 상태를 준비하고 있습니다.';
  if (roomInGame) return '이미 게임이 진행 중입니다.';
  if (startFlowBusy) return '게임 시작 요청을 처리하고 있습니다.';
  if (allReady) return '';
  if (playMode === 'team' && !teamBalanced) {
    return `청팀 ${Math.max(0, 2 - teamCounts.청팀)}명, 홍팀 ${Math.max(0, 2 - teamCounts.홍팀)}명이 더 필요해요.`;
  }
  return readyMissingCount > 0 ? `${readyMissingCount}명이 더 준비하면 시작할 수 있어요.` : '';
}
