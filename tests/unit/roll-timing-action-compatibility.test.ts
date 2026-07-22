import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeLegacyRollTimingAction } from '../../src/features/room/services/rollTimingActionCompatibility';

test('레거시 Normal 온라인 윷 액션은 Bad로 변환한다', () => {
  const action = {
    type: 'roll_yut' as const,
    actorId: 'seat-1',
    payload: { rollTimingZone: 'normal', clientActionId: 'legacy-roll' },
  };
  assert.deepEqual(normalizeLegacyRollTimingAction(action), {
    ...action,
    payload: { ...action.payload, rollTimingZone: 'bad' },
  });
});

test('새 타이밍 등급과 다른 액션은 변경하지 않는다', () => {
  const niceAction = {
    type: 'roll_yut' as const,
    actorId: 'seat-1',
    payload: { rollTimingZone: 'nice', clientActionId: 'new-roll' },
  };
  const moveAction = {
    type: 'move_piece' as const,
    actorId: 'seat-1',
    payload: { rollTimingZone: 'normal', pieceId: 'piece-1' },
  };
  assert.equal(normalizeLegacyRollTimingAction(niceAction), niceAction);
  assert.equal(normalizeLegacyRollTimingAction(moveAction), moveAction);
});
