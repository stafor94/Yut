import assert from 'node:assert/strict';
import test from 'node:test';
import { reduceAuthoritativeGameAction } from '../../src/features/room/services/roomAuthoritativeReducer';
import { TURN_ITEM_PROMPT_TIMEOUT_MS } from '../../src/features/room/services/roomTiming';

const makeState = () => ({
  pieces: [
    { id: 'p1', ownerId: 'seat-1', nodeIndex: 0, nodeId: 'n01', started: false, finished: false },
    { id: 'p2', ownerId: 'seat-2', nodeIndex: 0, nodeId: 'n01', started: false, finished: false },
  ],
  turnIndex: 0,
  turnOrderIds: ['seat-1', 'seat-2'],
  roll: null,
  rollStack: [],
  selectedRollStackIndex: null,
  rollStackClosed: false,
  boardItems: [],
  ownedItems: {},
  trapNodes: [],
  shieldedPieceIds: [],
  logs: [],
  winner: '',
  fallEffect: null,
  turnDeadlineAt: 0,
  turnDeadlineKind: 'roll' as const,
  itemPromptTiming: null,
  lastMovedPieceIds: [],
  lastMovedSeatId: '',
  branchChoice: 'outer' as const,
});

const rollFall = (state = makeState()) => reduceAuthoritativeGameAction(
  state,
  {
    type: 'roll_yut',
    actorId: 'seat-1',
    payload: {
      rollTimingZone: 'normal',
      clientRollResult: { name: '도', steps: 1 },
      clientFallOccurred: true,
      clientFallCount: 4,
      clientActionId: 'fall-roll',
      actorLogName: 'P1',
    },
  },
  { playMode: 'individual', pieceCount: 4, stackedRollMode: false },
);

test('온라인 낙 확정은 결과 표출 완료 전까지 실제 턴을 유지한다', () => {
  const result = rollFall();

  assert.equal(result.status, 'committed');
  assert.equal(result.patch?.turnIndex, 0);
  assert.equal(result.patch?.roll, null);
  assert.equal((result.patch?.fallEffect as { seatId?: string } | null)?.seatId, 'seat-1');
  assert.equal(result.payload?.fallPresentationPending, true);
  assert.match(String((result.patch?.logs as Array<{ text?: string }> | undefined)?.[0]?.text ?? ''), /P1님이 낙이 나왔습니다/);
  assert.doesNotMatch(String((result.patch?.logs as Array<{ text?: string }> | undefined)?.[0]?.text ?? ''), /차례를 넘깁니다/);
});

test('낙 결과 표출 대기 중에는 같은 플레이어의 새 윷 던지기를 거부한다', () => {
  const fall = rollFall();
  assert.equal(fall.status, 'committed');

  const result = reduceAuthoritativeGameAction(
    { ...makeState(), ...fall.patch },
    { type: 'roll_yut', actorId: 'seat-1', payload: { rollTimingZone: 'perfect' } },
    { playMode: 'individual', pieceCount: 4, stackedRollMode: false },
  );

  assert.equal(result.status, 'rejected');
  assert.equal(result.reason, '낙 결과 표출이 끝난 뒤 다음 차례로 넘어갑니다.');
});

test('낙 결과 표출 완료 액션에서만 다음 턴을 확정하고 fallEffect를 해제한다', () => {
  const now = 1_700_000_000_000;
  const originalNow = Date.now;
  Date.now = () => now;
  try {
    const fall = rollFall();
    assert.equal(fall.status, 'committed');
    const pendingState = {
      ...makeState(),
      ...fall.patch,
      ownedItems: { 'seat-2': ['golden_yut'] },
    };

    const result = reduceAuthoritativeGameAction(
      pendingState,
      {
        type: 'roll_yut',
        actorId: 'seat-1',
        payload: {
          completeFallPresentation: true,
          clientActionId: 'complete-fall-presentation',
        },
      },
      { playMode: 'individual', pieceCount: 4, stackedRollMode: false },
    );

    assert.equal(result.status, 'committed');
    assert.equal(result.patch?.turnIndex, 1);
    assert.equal(result.patch?.fallEffect, null);
    assert.equal(result.patch?.turnDeadlineKind, 'item_prompt');
    assert.equal(result.patch?.itemPromptTiming, 'before_roll');
    assert.equal(result.patch?.turnDeadlineAt, now + TURN_ITEM_PROMPT_TIMEOUT_MS);
    assert.equal(result.payload?.fallPresentationCompleted, true);
    assert.equal(result.payload?.nextActiveSeatId, 'seat-2');
  } finally {
    Date.now = originalNow;
  }
});

test('낙을 던지지 않은 플레이어는 결과 표출 완료를 확정할 수 없다', () => {
  const fall = rollFall();
  assert.equal(fall.status, 'committed');

  const result = reduceAuthoritativeGameAction(
    { ...makeState(), ...fall.patch },
    {
      type: 'roll_yut',
      actorId: 'seat-2',
      payload: { completeFallPresentation: true, clientActionId: 'wrong-actor' },
    },
    { playMode: 'individual', pieceCount: 4, stackedRollMode: false },
  );

  assert.equal(result.status, 'rejected');
  assert.equal(result.reason, '낙 결과 표출을 완료할 권한이 없습니다.');
});
