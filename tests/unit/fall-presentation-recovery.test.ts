import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isFallPresentationCompletionAction,
  shouldRetryFallPresentationCompletion,
  shouldWaitForGamePresentationBeforeCommit,
} from '../../src/features/room/services/fallPresentationCommitPolicy';

type SourceAction = Parameters<typeof isFallPresentationCompletionAction>[0];

const makeRollAction = (payload: Record<string, unknown>): SourceAction => ({
  type: 'roll_yut',
  actorId: 'seat-ai',
  payload,
});

test('실제 낙 표출 완료 액션만 presentation lock을 우회한다', () => {
  const completionAction = makeRollAction({
    completeFallPresentation: true,
    clientActionId: 'complete_fall_presentation:room-1:seat-ai:3',
  });

  assert.equal(isFallPresentationCompletionAction(completionAction), true);
  assert.equal(shouldWaitForGamePresentationBeforeCommit(completionAction), false);
});

test('일반 사용자·AI·timeout 윷 던지기는 계속 presentation lock을 기다린다', () => {
  const clientActionIds = [
    'roll_yut:seat-human:manual-request',
    'roll_yut_ai:seat-ai:3:0:server:server',
    'roll_timeout:room-1:3:0:seat-ai:roll:1234',
  ];

  clientActionIds.forEach((clientActionId) => {
    const action = makeRollAction({ rollTimingZone: 'normal', clientActionId });
    assert.equal(isFallPresentationCompletionAction(action), false);
    assert.equal(shouldWaitForGamePresentationBeforeCommit(action), true);
    assert.equal(shouldRetryFallPresentationCompletion(action, { status: 'rejected' }), false);
  });
});

test('낙 완료 커밋 성공과 중복 처리는 재시도하지 않는다', () => {
  const action = makeRollAction({ completeFallPresentation: true });

  assert.equal(shouldRetryFallPresentationCompletion(action, { status: 'committed' }), false);
  assert.equal(shouldRetryFallPresentationCompletion(action, { status: 'duplicate' }), false);
});

test('낙 완료 요청이 거부되거나 지원되지 않으면 화면 재시도 경로로 넘긴다', () => {
  const action = makeRollAction({ completeFallPresentation: true });

  assert.equal(shouldRetryFallPresentationCompletion(action, { status: 'rejected' }), true);
  assert.equal(shouldRetryFallPresentationCompletion(action, { status: 'unsupported' }), true);
});
