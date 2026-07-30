import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldDeferSameOrOlderSnapshotForPendingLocalMove } from '../../src/app/hooks/localOptimisticSnapshotPolicy.js';
import { PendingRemoteActionMetaStore, type PendingRemoteActionMeta } from '../../src/app/hooks/pendingRemoteActionMetaStore.js';

const makeMoveMeta = (optimisticApplied: boolean, actorId = 'red-seat'): PendingRemoteActionMeta => ({
  type: 'move_piece',
  actorId,
  createdAt: 1,
  createdSequence: 12,
  createdTurnIndex: 4,
  optimisticApplied,
});

test('서버 확인은 pending 잠금만 해제하고 optimistic 재생 차단 이력은 유지한다', () => {
  const store = new PendingRemoteActionMetaStore();
  const firstMutationId = 'move_piece:red-seat:12:4:red-piece-1';
  const nextMutationId = 'move_piece:red-seat:13:4:red-piece-1';

  store.set(firstMutationId, makeMoveMeta(true));
  assert.equal(store.size, 1);
  assert.equal(Array.from(store.values()).length, 1);

  assert.equal(store.acknowledge(firstMutationId), true);
  assert.equal(store.size, 0, '서버 확인 뒤 다음 턴 액션을 막는 pending 항목은 없어야 한다.');
  assert.equal(Array.from(store.values()).length, 0);
  assert.equal(store.get(firstMutationId)?.optimisticApplied, true, '같은 mutation sequence의 재생 차단 정보는 남아야 한다.');

  store.set(nextMutationId, makeMoveMeta(true));
  assert.equal(store.size, 1, '이전 확인 이력은 다음 이동 요청을 막지 않아야 한다.');
  assert.equal(store.get(nextMutationId)?.optimisticApplied, true);

  store.delete(firstMutationId);
  assert.equal(store.get(firstMutationId), undefined, '충돌·재동기화 정리는 확인 이력도 제거해야 한다.');
  store.clear();
  assert.equal(store.get(nextMutationId), undefined, '방 변경 정리는 pending과 확인 이력을 모두 제거해야 한다.');
});

test('로컬 묶음 이동 뒤 오래된 snapshot과 같은 mutation sequence가 와도 원위치 복귀나 재생이 없다', () => {
  const mutationId = 'move_piece:red-seat:12:4:red-piece-1';
  const store = new PendingRemoteActionMetaStore();
  store.set(mutationId, makeMoveMeta(true));

  let localPieces = { 'red-piece-1': 'n01', 'red-piece-2': 'n01' };
  const staleSnapshotPieces = { 'red-piece-1': 'n01', 'red-piece-2': 'n01' };
  const authoritativePieces = { 'red-piece-1': 'n03', 'red-piece-2': 'n03' };
  const postMovePositionHistory: string[] = [];
  let moveApplyCount = 0;
  let moveAnimationCount = 0;

  const recordPosition = () => {
    postMovePositionHistory.push(`${localPieces['red-piece-1']},${localPieces['red-piece-2']}`);
  };
  const applyDisplayedMove = (nextPieces: typeof localPieces) => {
    localPieces = { ...nextPieces };
    moveApplyCount += 1;
    moveAnimationCount += 1;
    recordPosition();
  };

  applyDisplayedMove(authoritativePieces);

  const deferStaleSnapshot = shouldDeferSameOrOlderSnapshotForPendingLocalMove({
    hasPendingLocalMove: store.size > 0,
    localSequence: 12,
    remoteSequence: 12,
  });
  if (!deferStaleSnapshot) {
    localPieces = { ...staleSnapshotPieces };
    recordPosition();
  }

  store.acknowledge(mutationId);
  if (!store.get(mutationId)?.optimisticApplied) applyDisplayedMove(authoritativePieces);

  assert.deepEqual(postMovePositionHistory, ['n03,n03']);
  assert.equal(postMovePositionHistory.includes('n01,n01'), false, '로컬 이동 완료 뒤 출발점으로 복귀하면 안 된다.');
  assert.equal(moveApplyCount, 1);
  assert.equal(moveAnimationCount, 1);
  assert.deepEqual(localPieces, authoritativePieces, '최종 로컬 상태는 저장·전파된 서버 상태와 같아야 한다.');
  assert.equal(store.size, 0, '서버 확인 뒤 mutation은 다음 이동을 차단하지 않아야 한다.');
});

test('새 sequence는 pending 이동 중에도 처리하고 상대·대리 AI 이동은 각각 한 번 재생한다', () => {
  assert.equal(shouldDeferSameOrOlderSnapshotForPendingLocalMove({
    hasPendingLocalMove: true,
    localSequence: 12,
    remoteSequence: 13,
  }), false, '새 authoritative sequence는 로컬 pending 이동과 별개로 누락하면 안 된다.');

  const store = new PendingRemoteActionMetaStore();
  const remoteMutationId = 'move_piece:blue-seat:12:4:blue-piece-1';
  const aiMutationId = 'move_piece_ai:blue-seat:12:4:blue-piece-1';
  let remoteReplayCount = 0;
  let aiReplayCount = 0;

  if (!store.get(remoteMutationId)?.optimisticApplied) remoteReplayCount += 1;

  store.set(aiMutationId, makeMoveMeta(false, 'blue-seat'));
  store.acknowledge(aiMutationId);
  if (!store.get(aiMutationId)?.optimisticApplied) aiReplayCount += 1;

  assert.equal(remoteReplayCount, 1, '상대 클라이언트 이동은 수신 측에서 한 번 재생되어야 한다.');
  assert.equal(aiReplayCount, 1, '대리 AI 이동은 optimistic 로컬 이동으로 오인하지 않고 한 번 재생되어야 한다.');
});

test('확인된 optimistic mutation 이력은 제한된 크기로 정리된다', () => {
  const store = new PendingRemoteActionMetaStore();
  for (let index = 0; index < 161; index += 1) {
    const mutationId = `move_piece:red-seat:${index}:4:red-piece-1`;
    store.set(mutationId, makeMoveMeta(true));
    store.acknowledge(mutationId);
  }

  assert.equal(store.size, 0);
  assert.equal(store.get('move_piece:red-seat:0:4:red-piece-1'), undefined, '가장 오래된 확인 이력은 제한을 넘으면 제거되어야 한다.');
  assert.equal(store.get('move_piece:red-seat:160:4:red-piece-1')?.optimisticApplied, true);
});
