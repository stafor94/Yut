import assert from 'node:assert/strict';
import test from 'node:test';
import { getBoardTurnIndicatorText } from '../../src/app/flows/boardTurnIndicator.js';

const makeSeat = (id: string, name: string) => ({ id, name });

const seats = [makeSeat('first', '튼튼한 소'), makeSeat('second', '행운의 돼지')];
const getPlayerCardName = (seat: ReturnType<typeof makeSeat>) => seat.name;

test('the active player nickname is shown without a turn suffix', () => {
  assert.equal(getBoardTurnIndicatorText({
    activeSeatTurnText: '튼튼한 소',
    getPlayerCardName,
    logs: [],
    seats,
    winner: '',
  }), '튼튼한 소');
});

test('game end keeps the latest acting player nickname instead of the winner summary', () => {
  assert.equal(getBoardTurnIndicatorText({
    activeSeatTurnText: '행운의 돼지',
    getPlayerCardName,
    logs: [
      { id: 3, text: '청팀이 승리했습니다.' },
      { id: 2, text: '튼튼한 소님이 말을 이동했습니다.' },
      { id: 1, text: '행운의 돼지님이 윷을 던졌습니다.' },
    ],
    seats,
    winner: '청팀 승리',
  }), '튼튼한 소');
});

test('an individual winner name is used when the final move log is unavailable', () => {
  assert.equal(getBoardTurnIndicatorText({
    activeSeatTurnText: '행운의 돼지',
    getPlayerCardName,
    logs: [],
    seats,
    winner: '튼튼한 소 승리',
  }), '튼튼한 소');
});
