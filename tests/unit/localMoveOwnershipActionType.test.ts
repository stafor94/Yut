import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareLocalMoveOwnership } from '../../src/app/flows/localMoveOwnership';

test('공통 authoritative action union의 non-move action은 local move ownership을 생성하지 않는다', () => {
  const action: {
    type: 'roll_yut' | 'move_piece';
    actorId: string;
    payload?: Record<string, unknown>;
  } = {
    type: 'roll_yut',
    actorId: 'P1',
    payload: { clientActionId: 'roll_yut:P1:1' },
  };

  assert.equal(prepareLocalMoveOwnership({
    roomId: 'room-a',
    state: {
      playMode: 'individual',
      pieceCount: 1,
      stackedRollMode: false,
      gameSeats: [
        { id: 'P1', team: '청팀' },
        { id: 'P2', team: '홍팀' },
      ],
    },
    action,
  }), null);
});
