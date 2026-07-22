import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveGoldenYutTimeout, resolveItemPickupTimeout, resolveItemPromptTimeout, resolveMoveTimeout, resolveTrapPlacementTimeout, makeTimeoutActionKey } from '../../src/features/room/services/timeoutResolvers';

test('황금 윷 timeout 기본값은 이름으로 찾은 모다', () => {
  assert.deepEqual(resolveGoldenYutTimeout(), { name: '모', steps: 5, bonus: true });
});

test('아이템 관련 timeout 기본 선택은 미사용/취소/기존 유지다', () => {
  assert.deepEqual(resolveItemPromptTimeout(), { useItem: false });
  assert.deepEqual(resolveTrapPlacementTimeout(), { cancelTrapPlacement: true });
  assert.deepEqual(resolveItemPickupTimeout(), { decision: 'keep' });
});

test('말 이동 timeout은 유효한 선택 말을 우선하고 없으면 결정적 후보를 고른다', () => {
  const pieces = [
    { id: 'b', label: '2', nodeId: 'n02', started: true, finished: false, ownerId: 'me' },
    { id: 'a', label: '1', nodeId: 'n01', started: false, finished: false, ownerId: 'me' },
  ];
  assert.equal(resolveMoveTimeout({ pieces, selectedPieceId: 'b', steps: 3, canControlPiece: (piece) => piece.ownerId === 'me', isSameSidePiece: () => true }).pieceId, 'b');
  assert.equal(resolveMoveTimeout({ pieces, selectedPieceId: 'missing', steps: 3, canControlPiece: (piece) => piece.ownerId === 'me', isSameSidePiece: () => true }).pieceId, 'b');
});

test('timeout action key는 단계 actor deadline sequence를 포함해 결정적이다', () => {
  const key = makeTimeoutActionKey({ roomId: 'room', stage: 'roll', actorId: 'seat-1', timeoutDeadlineAt: 1000, sequence: 7, extra: 'x' });
  assert.equal(key, makeTimeoutActionKey({ roomId: 'room', stage: 'roll', actorId: 'seat-1', timeoutDeadlineAt: 1000, sequence: 7, extra: 'x' }));
  assert.notEqual(key, makeTimeoutActionKey({ roomId: 'room', stage: 'move', actorId: 'seat-1', timeoutDeadlineAt: 1000, sequence: 7, extra: 'x' }));
});
