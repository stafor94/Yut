import test from 'node:test';
import assert from 'node:assert/strict';
import { reduceAuthoritativeGameAction } from '../../src/features/room/services/roomAuthoritativeReducer';

const makeState = () => ({
  pieces: [],
  turnIndex: 0,
  turnOrderIds: ['seat-1'],
  roll: null,
  rollStack: [],
  rollStackClosed: false,
  boardItems: [],
  trapNodes: [],
  shieldedPieceIds: [],
  logs: [],
  winner: '',
  ownedItems: {},
  turnDeadlineKind: 'roll' as const,
});

for (const timingZone of ['nice', 'bad'] as const) {
  test(`authoritative 윷 처리에서 ${timingZone} 타이밍 등급을 허용한다`, () => {
    const result = reduceAuthoritativeGameAction(
      makeState(),
      {
        type: 'roll_yut',
        actorId: 'seat-1',
        payload: {
          rollTimingZone: timingZone,
          clientRollResult: { name: '도', steps: 1 },
          clientFallOccurred: false,
          clientFallCount: 0,
        },
      },
      { playMode: 'individual', pieceCount: 4 },
    );

    assert.equal(result.status, 'committed');
    if (result.status !== 'committed') return;
    assert.equal(result.patch.lastRollTimingZone, timingZone);
    assert.equal(result.payload.timingZone, timingZone);
  });
}

test('폐기된 Normal 타이밍 등급은 authoritative 처리에서 거부한다', () => {
  const result = reduceAuthoritativeGameAction(
    makeState(),
    {
      type: 'roll_yut',
      actorId: 'seat-1',
      payload: {
        rollTimingZone: 'normal',
        clientRollResult: { name: '도', steps: 1 },
        clientFallOccurred: false,
        clientFallCount: 0,
      },
    },
    { playMode: 'individual', pieceCount: 4 },
  );

  assert.equal(result.status, 'rejected');
});
