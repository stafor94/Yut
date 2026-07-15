import assert from 'node:assert/strict';
import test from 'node:test';
import { getGamePresentationTurn } from '../../src/app/flows/gamePresentationTurn.js';

test('a remote fall keeps the throwing opponent as the displayed turn until presentation ends', () => {
  const duringFall = getGamePresentationTurn({
    activeSeatId: 'local-seat',
    localSeatId: 'local-seat',
    presentationActorId: 'opponent-seat',
  });
  assert.deepEqual(duringFall, {
    activeSeatId: 'opponent-seat',
    isMyTurn: false,
    isFrozen: true,
  });

  const afterFall = getGamePresentationTurn({
    activeSeatId: 'local-seat',
    localSeatId: 'local-seat',
  });
  assert.deepEqual(afterFall, {
    activeSeatId: 'local-seat',
    isMyTurn: true,
    isFrozen: false,
  });
});
