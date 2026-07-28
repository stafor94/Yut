import assert from 'node:assert/strict';
import test from 'node:test';
import {
  preserveLockedGameSeats,
  seatsWithJoinedPlayer,
} from '../../src/app/selectors/seatSelectors.js';
import type { Seat } from '../../src/app/appTypes.js';

const makeSeat = (overrides: Partial<Seat> & Pick<Seat, 'id' | 'label'>): Seat => ({
  name: overrides.id,
  color: '빨강',
  ready: true,
  isHost: false,
  isAI: false,
  isSubstitutedByAI: false,
  isEmpty: false,
  isSpectator: false,
  team: '청팀',
  ...overrides,
});

const basePlayers = [{
  id: 'player-1',
  nickname: '첫째',
  ready: true,
  color: 'red',
  seatIndex: 0,
  team: '청팀' as const,
}];

test('동일한 게임 좌석 snapshot은 기존 배열과 좌석 참조를 유지한다', () => {
  const currentSeats = [
    makeSeat({ id: 'human', label: 'P1', name: '사용자' }),
    makeSeat({ id: 'slot-2', label: 'P2', name: 'AI 친구 1', isAI: true }),
  ];
  const repeatedSnapshot = currentSeats.map((seat) => ({ ...seat }));

  const result = preserveLockedGameSeats(currentSeats, repeatedSnapshot);

  assert.equal(result, currentSeats);
  assert.equal(result[0], currentSeats[0]);
  assert.equal(result[1], currentSeats[1]);
});

test('좌석의 실제 상태가 바뀌면 새로운 배열을 반환한다', () => {
  const currentSeats = [
    makeSeat({ id: 'human', label: 'P1', name: '사용자' }),
    makeSeat({ id: 'slot-2', label: 'P2', name: 'AI 친구 1', isAI: true }),
  ];
  const changedSnapshot = currentSeats.map((seat) => seat.id === 'slot-2'
    ? { ...seat, name: '돌아온 사용자', isAI: false, isSubstitutedByAI: false }
    : { ...seat });

  const result = preserveLockedGameSeats(currentSeats, changedSnapshot);

  assert.notEqual(result, currentSeats);
  assert.equal(result[1]?.name, '돌아온 사용자');
  assert.equal(result[1]?.isAI, false);
});

test('빈 player snapshot 재입장에서는 실제 재입장 좌석만 점유한다', () => {
  const result = seatsWithJoinedPlayer([], 'player-2', '둘째', 'individual', 2, 1);

  assert.deepEqual(result.map(({ id, label, isEmpty, isHost }) => ({ id, label, isEmpty, isHost })), [
    { id: 'slot-1', label: 'P1', isEmpty: true, isHost: false },
    { id: 'player-2', label: 'P2', isEmpty: false, isHost: false },
  ]);
});

test('기존 player snapshot이 있으면 지정 좌석에 재입장 사용자를 배치한다', () => {
  const result = seatsWithJoinedPlayer(basePlayers, 'player-2', '둘째', 'individual', 2, 1);

  assert.equal(result[0]?.id, 'player-1');
  assert.equal(result[1]?.id, 'player-2');
  assert.equal(result[1]?.label, 'P2');
  assert.equal(result[1]?.isEmpty, false);
});

test('authoritative occupied 좌석은 같은 label의 stale identity를 교체한다', () => {
  const currentSeats = seatsWithJoinedPlayer([], 'stale-player', '이전 사용자', 'individual', 2, 1);
  const nextSeats = seatsWithJoinedPlayer(basePlayers, 'authoritative-player', '복귀 사용자', 'individual', 2, 1);

  const result = preserveLockedGameSeats(currentSeats, nextSeats);

  assert.equal(result[1]?.label, 'P2');
  assert.equal(result[1]?.id, 'authoritative-player');
  assert.equal(result[1]?.name, '복귀 사용자');
  assert.equal(result[1]?.isEmpty, false);
});

test('authoritative snapshot이 일시적으로 빈 좌석이면 잠긴 현재 좌석을 유지한다', () => {
  const currentSeats = seatsWithJoinedPlayer([], 'player-2', '둘째', 'individual', 2, 1);
  const emptySnapshot = [
    makeSeat({ id: 'slot-1', label: 'P1', name: '빈 자리', ready: false, isEmpty: true }),
    makeSeat({ id: 'slot-2', label: 'P2', name: '빈 자리', ready: false, isEmpty: true }),
  ];

  const result = preserveLockedGameSeats(currentSeats, emptySnapshot);

  assert.equal(result[1]?.id, 'player-2');
  assert.equal(result[1]?.isEmpty, false);
});
