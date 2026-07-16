import assert from 'node:assert/strict';
import test from 'node:test';
import {
  FALL_PRESENTATION_PENDING_REASON,
  getAutomatedFallPresentationRecoveryAction,
} from '../../src/features/room/services/fallPresentationRecovery';

type SourceAction = Parameters<typeof getAutomatedFallPresentationRecoveryAction>[0];
type SourceResult = Parameters<typeof getAutomatedFallPresentationRecoveryAction>[1];

const makeRollAction = (clientActionId: string): SourceAction => ({
  type: 'roll_yut',
  actorId: 'seat-ai',
  payload: {
    rollTimingZone: 'normal',
    clientActionId,
  },
});

const pendingFallRejection: SourceResult = {
  status: 'rejected',
  reason: FALL_PRESENTATION_PENDING_REASON,
};

test('presentation lock 이후의 AI 재던지기 거부는 낙 완료 복구 액션으로 변환한다', () => {
  const recovery = getAutomatedFallPresentationRecoveryAction(
    makeRollAction('roll_yut_ai:seat-ai:3:0:server:server'),
    pendingFallRejection,
  );

  assert.deepEqual(recovery, {
    type: 'roll_yut',
    actorId: 'seat-ai',
    payload: {
      completeFallPresentation: true,
      recoverySourceClientActionId: 'roll_yut_ai:seat-ai:3:0:server:server',
      clientActionId: 'complete_fall_presentation_recovery:roll_yut_ai:seat-ai:3:0:server:server',
    },
  });
});

test('제한 시간 자동 진행도 pending fall 거부 시 동일한 낙 완료 복구를 수행한다', () => {
  const recovery = getAutomatedFallPresentationRecoveryAction(
    makeRollAction('roll_timeout:room-1:3:0:seat-ai:roll:1234'),
    pendingFallRejection,
  );

  assert.equal(recovery?.payload?.completeFallPresentation, true);
  assert.equal(recovery?.actorId, 'seat-ai');
});

test('사용자의 일반 윷 던지기는 pending fall 거부를 자동 완료로 바꾸지 않는다', () => {
  const recovery = getAutomatedFallPresentationRecoveryAction(
    makeRollAction('roll_yut:seat-ai:manual-request'),
    pendingFallRejection,
  );

  assert.equal(recovery, null);
});

test('다른 거부 사유나 성공 결과는 자동 낙 완료 복구 대상이 아니다', () => {
  assert.equal(getAutomatedFallPresentationRecoveryAction(
    makeRollAction('roll_yut_ai:seat-ai:3:0:server:server'),
    { status: 'rejected', reason: '지금은 내 차례가 아닙니다.' },
  ), null);
  assert.equal(getAutomatedFallPresentationRecoveryAction(
    makeRollAction('roll_yut_ai:seat-ai:3:0:server:server'),
    { status: 'committed', reason: undefined },
  ), null);
});

test('이미 낙 완료 액션인 요청은 다시 복구 액션으로 감싸지 않는다', () => {
  const action = makeRollAction('roll_yut_ai:seat-ai:3:0:server:server');
  action.payload = { ...action.payload, completeFallPresentation: true };

  assert.equal(getAutomatedFallPresentationRecoveryAction(action, pendingFallRejection), null);
});
