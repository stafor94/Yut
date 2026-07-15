import assert from 'node:assert/strict';
import test from 'node:test';
import { getWaitingRoomStartHint } from '../../src/app/flows/gameStartFlow.js';

const baseInput = {
  initialGameEntryPending: false,
  roomInGame: false,
  startFlowBusy: false,
  allReady: false,
  playMode: 'individual' as const,
  teamBalanced: true,
  teamCounts: { 청팀: 0, 홍팀: 0 },
  readyMissingCount: 0,
};

test('준비 누락 인원이 0명이면 준비 안내 문구를 표시하지 않는다', () => {
  assert.equal(getWaitingRoomStartHint(baseInput), '');
});

test('준비하지 않은 좌석이 있을 때만 남은 인원 수를 표시한다', () => {
  assert.equal(
    getWaitingRoomStartHint({ ...baseInput, readyMissingCount: 2 }),
    '2명이 더 준비하면 시작할 수 있어요.',
  );
});

test('게임 시작 처리 중에는 팝업 외의 별도 안내 문구를 표시하지 않는다', () => {
  assert.equal(getWaitingRoomStartHint({ ...baseInput, startFlowBusy: true }), '');
  assert.equal(getWaitingRoomStartHint({ ...baseInput, initialGameEntryPending: true }), '');
});

test('팀 균형이 맞지 않으면 팀별 부족 인원을 표시한다', () => {
  assert.equal(
    getWaitingRoomStartHint({
      ...baseInput,
      playMode: 'team',
      teamBalanced: false,
      teamCounts: { 청팀: 1, 홍팀: 2 },
    }),
    '청팀 1명, 홍팀 0명이 더 필요해요.',
  );
});
