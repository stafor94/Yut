export type MoveSeatTransitionPhase = 'ending' | 'starting' | 'ready';

export type AuthoritativeTurnPresentationClock = {
  turnKey: string;
  hasAuthoritativeDeadline: boolean;
  displayAt: number;
  readyAt: number;
};

const EMPTY_TURN_PRESENTATION_CLOCK: AuthoritativeTurnPresentationClock = {
  turnKey: '',
  hasAuthoritativeDeadline: false,
  displayAt: 0,
  readyAt: 0,
};

let authoritativeTurnPresentationClock = EMPTY_TURN_PRESENTATION_CLOCK;
const authoritativeTurnPresentationListeners = new Set<() => void>();

export function publishAuthoritativeTurnPresentationClock(next: AuthoritativeTurnPresentationClock) {
  if (authoritativeTurnPresentationClock.turnKey === next.turnKey
    && authoritativeTurnPresentationClock.hasAuthoritativeDeadline === next.hasAuthoritativeDeadline
    && authoritativeTurnPresentationClock.displayAt === next.displayAt
    && authoritativeTurnPresentationClock.readyAt === next.readyAt) return;
  authoritativeTurnPresentationClock = next;
  authoritativeTurnPresentationListeners.forEach((listener) => listener());
}

export function getAuthoritativeTurnPresentationClockSnapshot() {
  return authoritativeTurnPresentationClock;
}

export function subscribeAuthoritativeTurnPresentationClock(listener: () => void) {
  authoritativeTurnPresentationListeners.add(listener);
  return () => authoritativeTurnPresentationListeners.delete(listener);
}

export function getTurnIndicatorTransitionDelayMs({
  turnKey,
  clock,
  now,
  fallbackMs,
}: {
  turnKey: string;
  clock: AuthoritativeTurnPresentationClock;
  now: number;
  fallbackMs: number;
}) {
  if (!turnKey
    || !clock.hasAuthoritativeDeadline
    || clock.turnKey !== turnKey
    || clock.displayAt <= 0) return Math.max(0, fallbackMs);
  return Math.max(0, clock.displayAt - now);
}

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
  hasAuthoritativeDeadline,
  authoritativeReadyAt,
  now,
}: {
  seatTransitionPhase: MoveSeatTransitionPhase;
  hasAuthoritativeDeadline: boolean;
  authoritativeReadyAt: number;
  now: number;
  turnActionPhase: 'roll' | 'move';
  moveRequestReady: boolean;
}) {
  const authoritativeActionReady = !hasAuthoritativeDeadline
    || !authoritativeReadyAt
    || now >= authoritativeReadyAt;
  return {
    authoritativeActionReady,
    actionReady: authoritativeActionReady,
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
