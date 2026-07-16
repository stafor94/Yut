import assert from 'node:assert/strict';
import test from 'node:test';
import { getGamePresentationTurn } from '../../src/app/flows/gamePresentationTurn.js';
import {
  EMPTY_ROLL_PRESENTATION_STATE,
  shouldDeferRollDerivedContent,
  type RollPresentationState,
} from '../../src/app/flows/rollPresentationVisibility.js';

const rememberPresentation = (presentation: RollPresentationState) => {
  shouldDeferRollDerivedContent({
    rollAnimationId: presentation.sourceAnimationId,
    presentation,
  });
};

test('진행 중인 낙 프레젠테이션은 authoritative 차례가 먼저 바뀌어도 actor 화면을 유지한다', () => {
  rememberPresentation({
    active: true,
    actorId: 'seat-ai',
    fallCount: 1,
    sourceAnimationId: 8101,
    resultVisible: true,
  });

  assert.deepEqual(getGamePresentationTurn({
    activeSeatId: 'seat-user',
    localSeatId: 'seat-user',
    presentationActorId: 'seat-ai',
  }), {
    activeSeatId: 'seat-ai',
    isMyTurn: false,
    isFrozen: true,
  });
});

test('낙 프레젠테이션 종료 후 남은 pending actor는 다음 authoritative 차례를 막지 않는다', () => {
  rememberPresentation(EMPTY_ROLL_PRESENTATION_STATE);

  assert.deepEqual(getGamePresentationTurn({
    activeSeatId: 'seat-user',
    localSeatId: 'seat-user',
    presentationActorId: 'seat-ai',
  }), {
    activeSeatId: 'seat-user',
    isMyTurn: true,
    isFrozen: false,
  });
});

test('낙 프레젠테이션 종료 후 같은 actor 차례가 다시 와도 턴 표시를 단독 배지로 고정하지 않는다', () => {
  rememberPresentation(EMPTY_ROLL_PRESENTATION_STATE);

  assert.deepEqual(getGamePresentationTurn({
    activeSeatId: 'seat-ai',
    localSeatId: 'seat-user',
    presentationActorId: 'seat-ai',
  }), {
    activeSeatId: 'seat-ai',
    isMyTurn: false,
    isFrozen: false,
  });
});

test('active seat 미확정 구간에서도 종료된 pending actor로 화면을 고정하지 않는다', () => {
  rememberPresentation(EMPTY_ROLL_PRESENTATION_STATE);

  assert.deepEqual(getGamePresentationTurn({
    localSeatId: 'seat-user',
    presentationActorId: 'seat-ai',
  }), {
    activeSeatId: '',
    isMyTurn: false,
    isFrozen: false,
  });
});

test('프레젠테이션 actor가 없으면 authoritative 차례를 그대로 사용한다', () => {
  rememberPresentation(EMPTY_ROLL_PRESENTATION_STATE);

  assert.deepEqual(getGamePresentationTurn({
    activeSeatId: 'seat-user',
    localSeatId: 'seat-user',
  }), {
    activeSeatId: 'seat-user',
    isMyTurn: true,
    isFrozen: false,
  });
});
