export type MoveSeatTransitionPhase = 'ending' | 'starting' | 'ready';

export function getMoveSeatTransitionPhase({
  actionableTurnKey,
  displayAt,
  readyAt,
  now,
}: {
  actionableTurnKey: string;
  displayAt: number;
  readyAt: number;
  now: number;
}): MoveSeatTransitionPhase {
  if (!actionableTurnKey || !readyAt || now >= readyAt) return 'ready';
  return displayAt && now < displayAt ? 'ending' : 'starting';
}

export function getMoveControlsActionReady({
  seatTransitionPhase,
  hasAuthoritativeDeadline,
  authoritativeReadyAt,
  now,
}: {
  seatTransitionPhase: MoveSeatTransitionPhase;
  hasAuthoritativeDeadline: boolean;
  authoritativeReadyAt: number;
  now: number;
}) {
  const authoritativeActionReady = !hasAuthoritativeDeadline
    || !authoritativeReadyAt
    || now >= authoritativeReadyAt;
  return {
    authoritativeActionReady,
    actionReady: seatTransitionPhase === 'ready' && authoritativeActionReady,
  };
}

export function getMoveActionButtonText({
  turnActionTimedOut,
  seatTransitionPhase,
  hasRoll,
  rollResultHolding,
  authoritativeActionReady,
  pendingTrapPlacement,
  waitingForOnlineTurnOrder,
  hasActiveTurnOrderIntro,
}: {
  turnActionTimedOut: boolean;
  seatTransitionPhase: MoveSeatTransitionPhase;
  hasRoll: boolean;
  rollResultHolding: boolean;
  authoritativeActionReady: boolean;
  pendingTrapPlacement: boolean;
  waitingForOnlineTurnOrder: boolean;
  hasActiveTurnOrderIntro: boolean;
}) {
  if (turnActionTimedOut) return '시간 초과 처리 중...';
  if (seatTransitionPhase === 'ending') return '턴 전환 중...';
  if (seatTransitionPhase === 'starting') return '잠시 후 행동 가능';
  if (hasRoll) return !authoritativeActionReady || rollResultHolding
    ? '결과 확인 중...'
    : '선택한 말 이동';
  if (pendingTrapPlacement) return '함정 설치 대기 중';
  if (waitingForOnlineTurnOrder) return '게임 시작 대기 중';
  if (hasActiveTurnOrderIntro) return '결과 확인 중';
  return '윷 던지기';
}
