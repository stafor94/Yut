import { getTurnRecoveryDeadlineAt } from './roomTiming';

export const MOVE_TIMEOUT_RECOVERY_RETRY_DELAY_MS = 600;
export const MOVE_TIMEOUT_RECOVERY_RETRY_LIMIT = 3;

export type MoveTimeoutRecoveryScope = {
  roomId: string;
  actorId: string;
  turnDeadlineKind: 'roll' | 'move' | 'item_prompt' | 'trap_placement' | '';
  turnDeadlineAt: number;
  coordinatorSeatId: string;
  coordinatorEpoch: number;
};

export type MoveTimeoutRecoveryDisposition =
  | 'terminal'
  | 'too-early'
  | 'retryable-state'
  | 'permanent';

const RETRYABLE_STATE_REASONS = [
  'coordinator lease가 만료되었거나 epoch가 일치하지 않습니다.',
  'authoritative sequence가 변경되어 최신 상태 재평가가 필요합니다.',
  '아직 게임 상태가 준비되지 않았습니다.',
  'authoritative 게임 설정 snapshot을 확인할 수 없습니다.',
  '게임 좌석 정보를 확인할 수 없습니다.',
  '먼저 윷을 던져주세요.',
  '지금은 내 차례가 아닙니다.',
  '선택한 이동 스택을 찾을 수 없습니다.',
  'timeout 대상 제한시간이 현재 상태와 일치하지 않습니다.',
];

export const getMoveTimeoutRecoverySchedule = (
  turnDeadlineAt: number,
  now = Date.now(),
) => {
  const recoveryAt = getTurnRecoveryDeadlineAt(turnDeadlineAt);
  return {
    recoveryAt,
    ready: Number.isFinite(turnDeadlineAt) && turnDeadlineAt > 0 && now >= recoveryAt,
    delayMs: Math.max(0, recoveryAt - now),
  };
};

export const isMoveTimeoutRecoveryScopeCurrent = (
  expected: MoveTimeoutRecoveryScope,
  current: MoveTimeoutRecoveryScope,
) => Boolean(
  expected.roomId
  && expected.roomId === current.roomId
  && expected.actorId
  && expected.actorId === current.actorId
  && expected.turnDeadlineKind === 'move'
  && current.turnDeadlineKind === 'move'
  && expected.turnDeadlineAt > 0
  && expected.turnDeadlineAt === current.turnDeadlineAt
  && expected.coordinatorSeatId
  && expected.coordinatorSeatId === current.coordinatorSeatId
  && expected.coordinatorEpoch > 0
  && expected.coordinatorEpoch === current.coordinatorEpoch
);

export const classifyMoveTimeoutRecoveryResult = (result: {
  status: string;
  reason?: string;
}): MoveTimeoutRecoveryDisposition => {
  if (result.status === 'committed' || result.status === 'duplicate') return 'terminal';
  if (result.reason === '시간초과 네트워크 유예 시간이 아직 남아 있습니다.') return 'too-early';
  if (result.reason && RETRYABLE_STATE_REASONS.includes(result.reason)) return 'retryable-state';
  return 'permanent';
};

export const canRetryMoveTimeoutRecovery = (
  disposition: MoveTimeoutRecoveryDisposition,
  attempt: number,
  retryLimit = MOVE_TIMEOUT_RECOVERY_RETRY_LIMIT,
) => (
  (disposition === 'too-early' || disposition === 'retryable-state')
  && attempt < retryLimit
);
