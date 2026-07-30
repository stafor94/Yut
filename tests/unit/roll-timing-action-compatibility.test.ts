import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeLegacyRollTimingAction } from '../../src/features/room/services/rollTimingActionCompatibility';

test('레거시 Normal 온라인 윷 액션은 Bad로 변환하고 기존 낙 개수 계약을 보존한다', () => {
  const action = {
    type: 'roll_yut' as const,
    actorId: 'seat-1',
    payload: {
      rollTimingZone: 'normal',
      clientActionId: 'legacy-roll',
      clientFallOccurred: true,
      clientFallCount: 4,
    },
  };
  assert.deepEqual(normalizeLegacyRollTimingAction(action), {
    ...action,
    payload: {
      ...action.payload,
      rollTimingZone: 'bad',
      legacyRollTimingZone: 'normal',
    },
  });
});

test('새 타이밍 등급의 윷 입력은 등급별 낙 개수로 정규화하고 다른 액션은 변경하지 않는다', () => {
  const niceAction = {
    type: 'roll_yut' as const,
    actorId: 'seat-1',
    payload: {
      rollTimingZone: 'nice',
      clientActionId: 'new-roll',
      clientFallOccurred: true,
      clientFallCount: 4,
    },
  };
  const moveAction = {
    type: 'move_piece' as const,
    actorId: 'seat-1',
    payload: { rollTimingZone: 'normal', pieceId: 'piece-1' },
  };
  assert.deepEqual(normalizeLegacyRollTimingAction(niceAction), {
    ...niceAction,
    payload: { ...niceAction.payload, clientFallCount: 1 },
  });
  assert.equal(normalizeLegacyRollTimingAction(moveAction), moveAction);
});
