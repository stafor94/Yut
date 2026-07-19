import assert from 'node:assert/strict';
import test from 'node:test';
import { preserveLockedGameSeats } from '../../src/app/selectors/seatSelectors.js';
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
