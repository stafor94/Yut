import assert from 'node:assert/strict';
import test from 'node:test';
import { isAuthoritativeCommitReduction, reduceAuthoritativeGameAction } from '../../src/features/room/services/roomAuthoritativeReducer';

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
  logs: [],
  winner: '',
  turnOrderPhase: { active: false },
  turnOrderIntro: null,
  pendingTrapPlacement: null,
  boardItems: [],
  ownedItems: {},
  trapNodes: [],
  shieldedPieceIds: [],
  branchChoice: 'outer' as const,
});

const room = { playMode: 'individual' as const, stackedRollMode: false };
const sides = [{ id: 'seat-1', team: '청팀' as const }, { id: 'seat-2', team: '홍팀' as const }];

test('온라인 윷 던지기는 클라이언트가 선확정한 정상 결과를 그대로 커밋한다', () => {
  const result = reduceAuthoritativeGameAction(makeState(), {
    type: 'roll_yut',
    actorId: 'seat-1',
    payload: {
      rollTimingZone: 'normal',
      clientRollResult: { name: '걸', steps: 3 },
      clientFallOccurred: false,
      clientFallCount: 0,
    },
  }, room, sides);

  assert.equal(isAuthoritativeCommitReduction(result), true);
  if (!isAuthoritativeCommitReduction(result)) return;
  assert.deepEqual(result.patch.roll, { name: '걸', steps: 3 });
  assert.deepEqual(result.payload.displayRoll, { name: '걸', steps: 3 });
  assert.equal(result.payload.fallOccurred, false);
  assert.equal(result.payload.fallCount, 0);
});

test('온라인 낙은 클라이언트가 선확정한 표시 결과와 낙 개수를 그대로 사용한다', () => {
  const result = reduceAuthoritativeGameAction(makeState(), {
    type: 'roll_yut',
    actorId: 'seat-1',
    payload: {
      rollTimingZone: 'normal',
      clientRollResult: { name: '개', steps: 2 },
      clientFallOccurred: true,
      clientFallCount: 3,
    },
  }, room, sides);

  assert.equal(isAuthoritativeCommitReduction(result), true);
  if (!isAuthoritativeCommitReduction(result)) return;
  assert.deepEqual(result.payload.displayRoll, { name: '개', steps: 2 });
  assert.equal(result.payload.fallOccurred, true);
  assert.equal(result.payload.fallCount, 3);
});

test('형식이 잘못된 클라이언트 윷 결과는 거부한다', () => {
  const result = reduceAuthoritativeGameAction(makeState(), {
    type: 'roll_yut',
    actorId: 'seat-1',
    payload: {
      rollTimingZone: 'normal',
      clientRollResult: { name: '모', steps: 1 },
      clientFallOccurred: false,
      clientFallCount: 0,
    },
  }, room, sides);

  assert.equal(result.status, 'rejected');
  assert.equal(result.reason, '클라이언트 윷 결과가 유효하지 않습니다.');
});
