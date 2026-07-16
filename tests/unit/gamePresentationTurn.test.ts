import assert from 'node:assert/strict';
import test from 'node:test';
import { getGamePresentationTurn } from '../../src/app/flows/gamePresentationTurn.js';
import {
  EMPTY_ROLL_PRESENTATION_STATE,
  shouldDeferRollDerivedContent,
} from '../../src/app/flows/rollPresentationVisibility.js';

test('a remote fall keeps the throwing opponent as the displayed turn until presentation ends', () => {
  shouldDeferRollDerivedContent({
    rollAnimationId: 1,
    presentation: {
      active: true,
      actorId: 'opponent-seat',
      fallCount: 1,
      sourceAnimationId: 1,
      resultVisible: true,
    },
  });

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

  shouldDeferRollDerivedContent({
    rollAnimationId: null,
    presentation: EMPTY_ROLL_PRESENTATION_STATE,
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
