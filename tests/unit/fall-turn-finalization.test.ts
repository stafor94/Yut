import assert from 'node:assert/strict';
import test from 'node:test';
import { FALL_PRESENTATION_GATE_MS, reduceAuthoritativeGameAction } from '../../src/features/room/services/roomAuthoritativeReducer';
import { TURN_ACTION_TIMEOUT_MS, TURN_ITEM_PROMPT_TIMEOUT_MS } from '../../src/features/room/services/roomTiming';

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
  rollResultReadyAt: 0,
  turnDeadlineAt: 0,
  turnDeadlineKind: 'roll' as const,
  itemPromptTiming: null,
  lastMovedPieceIds: [],
  lastMovedSeatId: '',
  branchChoice: 'outer' as const,
});

const room = { playMode: 'individual' as const, pieceCount: 4 as const, stackedRollMode: false };

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
  room,
);

test('온라인 낙 확정은 서버 턴을 한 번만 전환하고 공통 presentation gate를 저장한다', () => {
  const now = 1_700_000_000_000;
  const originalNow = Date.now;
  Date.now = () => now;
  try {
    const result = rollFall();

    assert.equal(result.status, 'committed');
    assert.equal(result.patch?.turnIndex, 1);
    assert.equal(result.patch?.roll, null);
    assert.equal((result.patch?.fallEffect as { seatId?: string } | null)?.seatId, 'seat-1');
    assert.equal(result.patch?.rollResultReadyAt, now + FALL_PRESENTATION_GATE_MS);
    assert.equal(result.patch?.turnDeadlineAt, now + FALL_PRESENTATION_GATE_MS + TURN_ACTION_TIMEOUT_MS);
    assert.equal(result.payload?.turnAdvancedIndependently, true);
    assert.equal(result.payload?.fallPresentationReadyAt, now + FALL_PRESENTATION_GATE_MS);
    assert.match(String((result.patch?.logs as Array<{ text?: string }> | undefined)?.[0]?.text ?? ''), /P1님이 낙이 나와 차례를 넘깁니다/);
  } finally {
    Date.now = originalNow;
  }
});

test('클라이언트 presentation 완료 요청은 authoritative event와 turn 상태를 변경하지 않는다', () => {
  const now = 1_700_000_000_000;
  const originalNow = Date.now;
  Date.now = () => now;
  try {
    const fall = rollFall();
    assert.equal(fall.status, 'committed');
    const pendingState = { ...makeState(), ...fall.patch };
    const effectBeforeCompletion = pendingState.fallEffect;

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
      room,
    );

    assert.equal(result.status, 'duplicate');
    assert.equal(result.patch, undefined);
    assert.equal(pendingState.turnIndex, 1);
    assert.equal(pendingState.rollResultReadyAt, now + FALL_PRESENTATION_GATE_MS);
    assert.equal(pendingState.fallEffect, effectBeforeCompletion);
  } finally {
    Date.now = originalNow;
  }
});

test('presentation gate 전에는 다음 플레이어의 윷 액션을 authoritative reducer가 거부한다', () => {
  const now = 1_700_000_000_000;
  const originalNow = Date.now;
  Date.now = () => now;
  try {
    const fall = rollFall();
    assert.equal(fall.status, 'committed');
    const stateAfterFall = { ...makeState(), ...fall.patch };

    const result = reduceAuthoritativeGameAction(
      stateAfterFall,
      { type: 'roll_yut', actorId: 'seat-2', payload: { rollTimingZone: 'perfect' } },
      room,
    );

    assert.equal(result.status, 'rejected');
    assert.equal(result.reason, '이전 윷 결과 표출이 끝난 뒤 던질 수 있습니다.');
  } finally {
    Date.now = originalNow;
  }
});

test('presentation gate 이후에는 완료 callback 없이 다음 플레이어가 진행하고 기존 event를 교체한다', () => {
  const startedAt = 1_700_000_000_000;
  let now = startedAt;
  const originalNow = Date.now;
  Date.now = () => now;
  try {
    const fall = rollFall();
    assert.equal(fall.status, 'committed');
    const stateAfterFall = { ...makeState(), ...fall.patch };
    now = startedAt + FALL_PRESENTATION_GATE_MS;

    const result = reduceAuthoritativeGameAction(
      stateAfterFall,
      {
        type: 'roll_yut',
        actorId: 'seat-2',
        payload: {
          rollTimingZone: 'perfect',
          clientRollResult: { name: '도', steps: 1 },
          clientFallOccurred: false,
          clientFallCount: 0,
        },
      },
      room,
    );

    assert.equal(result.status, 'committed');
    assert.equal(result.patch?.turnIndex, undefined);
    assert.equal(result.patch?.fallEffect, null);
  } finally {
    Date.now = originalNow;
  }
});

test('다음 플레이어의 before_roll 아이템 시간은 presentation gate 뒤부터 계산한다', () => {
  const now = 1_700_000_000_000;
  const originalNow = Date.now;
  Date.now = () => now;
  try {
    const fall = rollFall({
      ...makeState(),
      ownedItems: { 'seat-2': ['golden_yut'] },
    });

    assert.equal(fall.status, 'committed');
    assert.equal(fall.patch?.turnIndex, 1);
    assert.equal(fall.patch?.turnDeadlineKind, 'item_prompt');
    assert.equal(fall.patch?.itemPromptTiming, 'before_roll');
    assert.equal(fall.patch?.turnDeadlineAt, now + FALL_PRESENTATION_GATE_MS + TURN_ITEM_PROMPT_TIMEOUT_MS);
  } finally {
    Date.now = originalNow;
  }
});

test('낙을 던지지 않은 actor는 presentation 완료를 가장해도 event에 접근할 수 없다', () => {
  const fall = rollFall();
  assert.equal(fall.status, 'committed');

  const result = reduceAuthoritativeGameAction(
    { ...makeState(), ...fall.patch },
    {
      type: 'roll_yut',
      actorId: 'seat-2',
      payload: { completeFallPresentation: true, clientActionId: 'wrong-actor' },
    },
    room,
  );

  assert.equal(result.status, 'rejected');
  assert.equal(result.reason, '낙 결과 표출을 완료할 권한이 없습니다.');
});

test('이미 다음 roll이 event를 교체한 뒤 도착한 완료 요청도 상태를 변경하지 않는다', () => {
  const result = reduceAuthoritativeGameAction(
    { ...makeState(), turnIndex: 1, fallEffect: null, rollResultReadyAt: Date.now() + FALL_PRESENTATION_GATE_MS },
    {
      type: 'roll_yut',
      actorId: 'seat-1',
      payload: { completeFallPresentation: true, clientActionId: 'duplicate-completion' },
    },
    room,
  );

  assert.equal(result.status, 'duplicate');
  assert.equal(result.patch, undefined);
});
