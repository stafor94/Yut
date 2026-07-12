import assert from 'node:assert/strict';
import test from 'node:test';
import { getOnlineGameCoordinatorSeatId } from '../../src/app/flows/onlineGameCoordinator.js';

test('기존 coordinator가 계속 human이면 재접속한 앞 좌석보다 기존 coordinator를 유지한다', () => {
  const seats = [{ id: 'seat-1' }, { id: 'seat-2' }];
  assert.equal(getOnlineGameCoordinatorSeatId(seats, 'seat-2'), 'seat-2');
});

test('기존 coordinator가 AI로 대체되면 다음 human에게 승계한다', () => {
  const seats = [{ id: 'seat-1', isAI: true }, { id: 'seat-2' }];
  assert.equal(getOnlineGameCoordinatorSeatId(seats, 'seat-1'), 'seat-2');
});
