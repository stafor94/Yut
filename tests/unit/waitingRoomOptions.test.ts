import assert from 'node:assert/strict';
import test from 'node:test';
import { getChangedWaitingRoomOptions, resolveWaitingRoomOptions, type WaitingRoomOptions } from '../../src/app/flows/waitingRoomOptions.js';

const initialOptions: WaitingRoomOptions = {
  playMode: 'individual',
  maxPlayers: 2,
  itemMode: false,
  stackedRollMode: false,
  pieceCount: 4,
};

test('팀전 전환은 4인과 팀별 말 2개를 같은 변경 묶음으로 만든다', () => {
  const next = resolveWaitingRoomOptions(initialOptions, { playMode: 'team' });

  assert.deepEqual(next, {
    playMode: 'team',
    maxPlayers: 4,
    itemMode: false,
    stackedRollMode: false,
    pieceCount: 2,
  });
  assert.deepEqual(getChangedWaitingRoomOptions(initialOptions, next), {
    playMode: 'team',
    maxPlayers: 4,
    pieceCount: 2,
  });
});

test('연속 옵션 변경은 최신 로컬 상태를 기준으로 실제 변경 필드만 저장한다', () => {
  const teamOptions = resolveWaitingRoomOptions(initialOptions, { playMode: 'team' });
  const stackedOptions = resolveWaitingRoomOptions(teamOptions, { stackedRollMode: true });
  const teamPatch = getChangedWaitingRoomOptions(initialOptions, teamOptions);
  const stackedPatch = getChangedWaitingRoomOptions(teamOptions, stackedOptions);

  assert.deepEqual(stackedPatch, { stackedRollMode: true });
  assert.deepEqual({ ...initialOptions, ...teamPatch, ...stackedPatch }, {
    playMode: 'team',
    maxPlayers: 4,
    itemMode: false,
    stackedRollMode: true,
    pieceCount: 2,
  });
});

test('팀전에서는 잘못된 인원 축소 요청을 4인으로 정규화한다', () => {
  const teamOptions = resolveWaitingRoomOptions(initialOptions, { playMode: 'team' });
  const next = resolveWaitingRoomOptions(teamOptions, { maxPlayers: 2 });

  assert.equal(next.maxPlayers, 4);
  assert.deepEqual(getChangedWaitingRoomOptions(teamOptions, next), {});
});
