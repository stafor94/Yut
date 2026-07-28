import test from 'node:test';
import assert from 'node:assert/strict';
import {
  makeTimeoutActionKey,
  resolveGoldenYutTimeout,
  resolveItemPickupTimeout,
  resolveItemPromptTimeout,
  resolveMoveTimeout,
  resolveMoveTimeoutContext,
  resolveRollTimeout,
  resolveTrapPlacementTimeout,
} from '../../src/features/room/services/timeoutResolvers';

const doRoll = { name: '도', steps: 1 } as const;
const gaeRoll = { name: '개', steps: 2 } as const;
const geolRoll = { name: '걸', steps: 3 } as const;

test('황금 윷 timeout 기본값은 이름으로 찾은 모다', () => {
  assert.deepEqual(resolveGoldenYutTimeout(), { name: '모', steps: 5, bonus: true });
});

test('아이템 관련 timeout 기본 선택은 미사용/취소/기존 유지다', () => {
  assert.deepEqual(resolveItemPromptTimeout(), { useItem: false });
  assert.deepEqual(resolveTrapPlacementTimeout(), { cancelTrapPlacement: true });
  assert.deepEqual(resolveItemPickupTimeout(), { decision: 'keep' });
});

test('coordinator 던지기 fallback은 authoritative timeout window의 공유 오브 위치로 판정한다', () => {
  const perfect = resolveRollTimeout(1_000_000, 500);
  const bad = resolveRollTimeout(1_000_000, 1000);
  assert.deepEqual(perfect, { timingPositionPercent: 50, rollTimingZone: 'perfect' });
  assert.deepEqual(bad, { timingPositionPercent: 100, rollTimingZone: 'bad' });
});

test('말 이동 timeout은 유효한 선택 말을 우선하고 없으면 결정적 후보를 고른다', () => {
  const pieces = [
    { id: 'b', label: '2', nodeId: 'n02', started: true, finished: false, ownerId: 'me' },
    { id: 'a', label: '1', nodeId: 'n01', started: false, finished: false, ownerId: 'me' },
  ];
  assert.equal(resolveMoveTimeout({ pieces, selectedPieceId: 'b', steps: 3, canControlPiece: (piece) => piece.ownerId === 'me', isSameSidePiece: () => true }).pieceId, 'b');
  assert.equal(resolveMoveTimeout({ pieces, selectedPieceId: 'missing', steps: 3, canControlPiece: (piece) => piece.ownerId === 'me', isSameSidePiece: () => true }).pieceId, 'b');
});

test('다중 미선택 이동 스택 timeout은 서로 다른 결과에서도 0번을 사용한다', () => {
  assert.deepEqual(resolveMoveTimeoutContext({
    stackedRollMode: true,
    roll: null,
    rollStack: [doRoll, geolRoll],
    rollStackClosed: true,
    selectedRollStackIndex: null,
  }), {
    roll: doRoll,
    rollStackIndex: 0,
    steps: 1,
    reason: 'default-first',
  });
});

test('동일 결과가 여러 개인 미선택 이동 스택도 배열의 0번을 사용한다', () => {
  assert.deepEqual(resolveMoveTimeoutContext({
    stackedRollMode: true,
    roll: null,
    rollStack: [gaeRoll, { ...gaeRoll }],
    rollStackClosed: true,
    selectedRollStackIndex: null,
  }), {
    roll: gaeRoll,
    rollStackIndex: 0,
    steps: 2,
    reason: 'default-first',
  });
});

test('유효한 선택 인덱스를 유지하고 단일 스택은 0번을 선택한다', () => {
  assert.deepEqual(resolveMoveTimeoutContext({
    stackedRollMode: true,
    roll: null,
    rollStack: [doRoll, geolRoll],
    rollStackClosed: true,
    selectedRollStackIndex: 1,
  }), {
    roll: geolRoll,
    rollStackIndex: 1,
    steps: 3,
    reason: 'selected',
  });
  assert.deepEqual(resolveMoveTimeoutContext({
    stackedRollMode: true,
    roll: null,
    rollStack: [gaeRoll],
    rollStackClosed: true,
    selectedRollStackIndex: null,
  }), {
    roll: gaeRoll,
    rollStackIndex: 0,
    steps: 2,
    reason: 'single',
  });
});

test('비누적 timeout은 현재 roll을 스택 인덱스 없이 사용한다', () => {
  assert.deepEqual(resolveMoveTimeoutContext({
    stackedRollMode: false,
    roll: geolRoll,
    rollStack: [],
    rollStackClosed: false,
    selectedRollStackIndex: null,
  }), {
    roll: geolRoll,
    rollStackIndex: null,
    steps: 3,
    reason: 'non-stacked',
  });
});

test('열린 스택·빈 스택·잘못된 인덱스·유효하지 않은 결과는 임의 복구하지 않는다', () => {
  const unresolved = { roll: null, rollStackIndex: null, steps: 0, reason: 'unresolved' };
  assert.deepEqual(resolveMoveTimeoutContext({
    stackedRollMode: true,
    roll: null,
    rollStack: [doRoll],
    rollStackClosed: false,
    selectedRollStackIndex: null,
  }), unresolved);
  assert.deepEqual(resolveMoveTimeoutContext({
    stackedRollMode: true,
    roll: null,
    rollStack: [],
    rollStackClosed: true,
    selectedRollStackIndex: null,
  }), unresolved);
  assert.deepEqual(resolveMoveTimeoutContext({
    stackedRollMode: true,
    roll: null,
    rollStack: [doRoll, geolRoll],
    rollStackClosed: true,
    selectedRollStackIndex: 4,
  }), unresolved);
  assert.deepEqual(resolveMoveTimeoutContext({
    stackedRollMode: true,
    roll: null,
    rollStack: [{ name: '도', steps: Number.NaN }],
    rollStackClosed: true,
    selectedRollStackIndex: null,
  }), unresolved);
});

test('timeout context의 steps가 기존 결정적 말 선택에 그대로 사용된다', () => {
  const context = resolveMoveTimeoutContext({
    stackedRollMode: true,
    roll: null,
    rollStack: [geolRoll, doRoll],
    rollStackClosed: true,
    selectedRollStackIndex: null,
  });
  const pieces = [
    { id: 'piece-2', label: '2', nodeId: 'start', started: false, finished: false, ownerId: 'me' },
    { id: 'piece-1', label: '1', nodeId: 'n02', started: true, finished: false, ownerId: 'me' },
  ];
  assert.deepEqual(resolveMoveTimeout({
    pieces,
    selectedPieceId: '',
    steps: context.steps,
    canControlPiece: (piece) => piece.ownerId === 'me',
    isSameSidePiece: () => true,
  }), { pieceId: 'piece-1', branchChoice: 'outer', reason: 'deterministic' });
});

test('timeout action key는 local sequence 차이와 무관하게 같은 deadline을 중복 제거한다', () => {
  const first = makeTimeoutActionKey({ roomId: 'room', stage: 'roll', actorId: 'seat-1', timeoutDeadlineAt: 1000, sequence: 7, extra: 'first-client' });
  const second = makeTimeoutActionKey({ roomId: 'room', stage: 'roll', actorId: 'seat-1', timeoutDeadlineAt: 1000, sequence: 9, extra: 'second-client' });
  assert.equal(first, second);
  assert.notEqual(first, makeTimeoutActionKey({ roomId: 'room', stage: 'move', actorId: 'seat-1', timeoutDeadlineAt: 1000 }));
  assert.notEqual(first, makeTimeoutActionKey({ roomId: 'room', stage: 'roll', actorId: 'seat-1', timeoutDeadlineAt: 1001 }));
});
