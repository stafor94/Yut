import assert from 'node:assert/strict';
import test from 'node:test';
import { getGamePresentationTurn } from '../../src/app/flows/gamePresentationTurn';

test('현재 authoritative 차례의 낙 프레젠테이션은 해당 actor로 화면을 고정한다', () => {
  assert.deepEqual(getGamePresentationTurn({
    activeSeatId: 'seat-ai',
    localSeatId: 'seat-user',
    presentationActorId: 'seat-ai',
  }), {
    activeSeatId: 'seat-ai',
    isMyTurn: false,
    isFrozen: true,
  });
});

test('active seat가 아직 없는 초기 전환 구간에서는 낙 프레젠테이션 actor를 유지한다', () => {
  assert.deepEqual(getGamePresentationTurn({
    localSeatId: 'seat-user',
    presentationActorId: 'seat-ai',
  }), {
    activeSeatId: 'seat-ai',
    isMyTurn: false,
    isFrozen: true,
  });
});

test('authoritative 차례가 다음 플레이어로 넘어가면 오래된 낙 actor가 조작 UI를 막지 않는다', () => {
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

test('낙 프레젠테이션이 없으면 authoritative 차례를 그대로 표시한다', () => {
  assert.deepEqual(getGamePresentationTurn({
    activeSeatId: 'seat-user',
    localSeatId: 'seat-user',
  }), {
    activeSeatId: 'seat-user',
    isMyTurn: true,
    isFrozen: false,
  });
});
