import assert from 'node:assert/strict';
import test from 'node:test';
import { isValidElement, type ReactNode } from 'react';
import { getBoardTurnIndicatorText } from '../../src/app/flows/boardTurnIndicator.js';

const makeSeat = (id: string, label: string, name: string, team: '청팀' | '홍팀') => ({ id, label, name, team });

const firstSeat = makeSeat('first', 'P1', '튼튼한 소', '홍팀');
const secondSeat = makeSeat('second', 'P2', '행운의 돼지', '청팀');
const thirdSeat = makeSeat('third', 'P3', '용감한 용', '홍팀');
const fourthSeat = makeSeat('fourth', 'P4', '차분한 토끼', '청팀');
const seats = [firstSeat, secondSeat, thirdSeat, fourthSeat];
const getPlayerCardName = (seat: ReturnType<typeof makeSeat>) => seat.name;

const getWinnerElementProps = (value: ReactNode) => {
  assert.ok(isValidElement<{ className: string; children: ReactNode }>(value));
  return value.props;
};

test('the active player nickname is shown without a turn suffix', () => {
  assert.equal(getBoardTurnIndicatorText({
    activeSeatTurnText: '튼튼한 소',
    getPlayerCardName,
    logs: [],
    seats,
    winner: '',
  }), '튼튼한 소');
});

test('a team winner shows every teammate nickname once with the team color class', () => {
  const props = getWinnerElementProps(getBoardTurnIndicatorText({
    activeSeatTurnText: '행운의 돼지',
    getPlayerCardName,
    logs: [
      { id: 3, text: '홍팀이 승리했습니다.' },
      { id: 2, text: '튼튼한 소님이 말을 이동했습니다.' },
    ],
    seats: [...seats, firstSeat, thirdSeat],
    winner: '홍팀 승리',
  }));

  assert.equal(props.children, '튼튼한 소 · 용감한 용');
  assert.match(props.className, /winner-team-red/);
});

test('an individual winner nickname carries the matching player color class', () => {
  const props = getWinnerElementProps(getBoardTurnIndicatorText({
    activeSeatTurnText: '행운의 돼지',
    getPlayerCardName,
    logs: [],
    seats,
    winner: '용감한 용 승리',
  }));

  assert.equal(props.children, '용감한 용');
  assert.match(props.className, /winner-player-3/);
});
