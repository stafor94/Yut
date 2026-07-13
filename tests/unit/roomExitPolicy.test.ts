import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldDeleteHostedRoomOnGameExit } from '../../src/features/room/services/roomExitPolicy';

const playingRoom = { hostId: 'host-1', status: 'playing' as const, startStatus: 'playing' as const };

test('방장이 진행 중 게임 종료를 선택하면 방을 삭제한다', () => {
  assert.equal(shouldDeleteHostedRoomOnGameExit(playingRoom, 'host-1', 'ai_substitution'), true);
  assert.equal(shouldDeleteHostedRoomOnGameExit(playingRoom, 'host-1', 'player_removal'), true);
});

test('일반 참가자의 게임 종료는 방 전체를 삭제하지 않는다', () => {
  assert.equal(shouldDeleteHostedRoomOnGameExit(playingRoom, 'guest-1', 'ai_substitution'), false);
  assert.equal(shouldDeleteHostedRoomOnGameExit(playingRoom, 'guest-1', 'player_removal'), false);
});

test('게임을 시작하지 않은 대기실에서 방장이 나가도 게임 종료 정책을 적용하지 않는다', () => {
  const waitingRoom = { hostId: 'host-1', status: 'waiting' as const, startStatus: 'idle' as const };
  assert.equal(shouldDeleteHostedRoomOnGameExit(waitingRoom, 'host-1', 'player_removal'), false);
});

test('완료 상태로 기록된 방에서도 방장의 종료 요청은 방을 삭제한다', () => {
  const finishedRoom = { hostId: 'host-1', status: 'finished' as const, startStatus: 'playing' as const };
  assert.equal(shouldDeleteHostedRoomOnGameExit(finishedRoom, 'host-1', 'player_removal'), true);
});
