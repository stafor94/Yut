import assert from 'node:assert/strict';
import test from 'node:test';
import { reduceAuthoritativeGameAction } from '../../src/features/room/services/roomAuthoritativeReducer';

const room = { playMode: 'individual' as const, pieceCount: 4 as const, stackedRollMode: true };

const makeState = () => ({
  pieces: [
    { id: 'human-piece-1', ownerId: 'human', nodeIndex: 3, nodeId: 'n04', started: true, finished: false },
    { id: 'ai-1-piece-1', ownerId: 'ai-1', nodeIndex: 0, nodeId: 'n01', started: false, finished: false },
    { id: 'ai-2-piece-1', ownerId: 'ai-2', nodeIndex: 2, nodeId: 'n03', started: true, finished: false },
  ],
  turnIndex: 0,
  turnOrderIds: ['human', 'ai-1', 'ai-2'],
  roll: null,
  rollStack: [],
  selectedRollStackIndex: null,
  rollStackClosed: false,
  logs: [],
  winner: '',
  boardItems: [],
  trapNodes: [],
  shieldedPieceIds: [],
  ownedItems: { human: ['golden_yut' as const] },
  itemPromptTiming: 'before_roll' as const,
  pendingAfterMoveTurnIndex: undefined,
  pendingGoldenYutSelection: null,
  turnDeadlineAt: 1,
  turnDeadlineKind: 'item_prompt' as const,
});

test('before_roll 아이템을 사용하지 않은 뒤 보유 아이템을 유지한 채 윷을 던질 수 있다', () => {
  const state = makeState();
  const skipped = reduceAuthoritativeGameAction(
    state,
    { type: 'use_item', actorId: 'human', payload: { skipBeforeRollItem: true } },
    room,
  );

  assert.equal(skipped.status, 'committed');
  assert.equal(skipped.patch?.itemPromptTiming, null);
  assert.equal(skipped.patch?.turnDeadlineKind, 'roll');

  const stateAfterSkip = { ...state, ...skipped.patch };
  assert.deepEqual(stateAfterSkip.ownedItems, { human: ['golden_yut'] });

  const rolled = reduceAuthoritativeGameAction(
    stateAfterSkip,
    {
      type: 'roll_yut',
      actorId: 'human',
      payload: {
        rollTimingZone: 'good',
        clientRollResult: { name: '개', steps: 2 },
        clientFallOccurred: false,
        clientFallCount: 0,
      },
    },
    room,
  );

  assert.equal(rolled.status, 'committed');
  assert.deepEqual(rolled.patch?.rollStack, [{ name: '개', steps: 2 }]);
  assert.equal(rolled.patch?.rollStackClosed, true);
});

test('before_roll 선택 대기가 실제로 열려 있으면 윷 던지기를 계속 차단한다', () => {
  const rolled = reduceAuthoritativeGameAction(
    makeState(),
    {
      type: 'roll_yut',
      actorId: 'human',
      payload: {
        rollTimingZone: 'good',
        clientRollResult: { name: '개', steps: 2 },
        clientFallOccurred: false,
        clientFallCount: 0,
      },
    },
    room,
  );

  assert.equal(rolled.status, 'rejected');
  assert.equal(rolled.reason, '아이템 사용 여부를 먼저 선택해주세요.');
});
