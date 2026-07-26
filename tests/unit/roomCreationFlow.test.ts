import assert from 'node:assert/strict';
import test from 'node:test';
import {
  RoomCreationTimeoutError,
  createRoomRequestIdentity,
  isMatchingCreatedRoom,
  isRoomTransitionInProgress,
  resolveRoomCreationTimeoutMs,
  withOperationTimeout,
} from '../../src/app/flows/roomCreationFlow.js';
import { ROOM_CREATION_TIMEOUT_MS } from '../../src/features/room/services/roomCreationTiming.js';

const delay = (delayMs: number) => new Promise<void>((resolve) => setTimeout(resolve, delayMs));

test('로그인과 방 생성 timeout은 각 작업마다 독립적으로 새로 시작한다', async () => {
  await withOperationTimeout(delay(8), 30, 'auth');
  await withOperationTimeout(delay(20), 30, 'create');
});

test('작업 제한 시간이 지나면 작업 종류가 포함된 timeout 오류를 반환한다', async () => {
  await assert.rejects(
    withOperationTimeout(new Promise<void>(() => undefined), 5, 'create'),
    (error: unknown) => error instanceof RoomCreationTimeoutError && error.operation === 'create',
  );
});

test('브라우저 timeout callback이 지연돼도 화면 frame의 절대 deadline으로 종료한다', async () => {
  let now = 0;
  let frameCallback: ((timestamp: number) => void) | undefined;
  let cancelledTimeout = 0;
  let cancelledFrame = 0;
  const pendingOperation = new Promise<void>(() => undefined);
  const result = withOperationTimeout(pendingOperation, 10, 'create', {
    now: () => now,
    setTimeout: () => 11 as ReturnType<typeof setTimeout>,
    clearTimeout: () => { cancelledTimeout += 1; },
    requestAnimationFrame: (callback) => {
      frameCallback = callback;
      return 22;
    },
    cancelAnimationFrame: () => { cancelledFrame += 1; },
  });

  now = 9;
  frameCallback?.(9);
  now = 10;
  frameCallback?.(10);

  await assert.rejects(
    result,
    (error: unknown) => error instanceof RoomCreationTimeoutError && error.operation === 'create',
  );
  assert.equal(cancelledTimeout, 1);
  assert.equal(cancelledFrame, 0);
});

test('작업이 먼저 완료되면 timeout과 frame 감시를 모두 정리한다', async () => {
  let cancelledTimeout = 0;
  let cancelledFrame = 0;
  const result = await withOperationTimeout(Promise.resolve('done'), 10, 'create', {
    now: () => 0,
    setTimeout: () => 33 as ReturnType<typeof setTimeout>,
    clearTimeout: () => { cancelledTimeout += 1; },
    requestAnimationFrame: () => 44,
    cancelAnimationFrame: () => { cancelledFrame += 1; },
  });

  assert.equal(result, 'done');
  assert.equal(cancelledTimeout, 1);
  assert.equal(cancelledFrame, 1);
});

test('운영 방 생성 관련 timeout은 모두 10초 기준으로 통일한다', () => {
  assert.equal(ROOM_CREATION_TIMEOUT_MS, 10_000);
  assert.equal(resolveRoomCreationTimeoutMs(12_000, 'auth'), ROOM_CREATION_TIMEOUT_MS);
  assert.equal(resolveRoomCreationTimeoutMs(12_000, 'create'), ROOM_CREATION_TIMEOUT_MS);
  assert.equal(resolveRoomCreationTimeoutMs(5_000, 'recover'), ROOM_CREATION_TIMEOUT_MS);
});

test('동일 생성 요청은 같은 room id와 create request id를 사용한다', () => {
  assert.deepEqual(createRoomRequestIdentity('abc-123'), {
    roomId: 'room-abc-123',
    createRequestId: 'abc-123',
  });
  assert.deepEqual(createRoomRequestIdentity('a:b/c'), {
    roomId: 'room-abc',
    createRequestId: 'abc',
  });
});

test('timeout 복구는 정확히 같은 room, host, request만 허용한다', () => {
  const request = { roomId: 'room-request-1', hostId: 'host-1', createRequestId: 'request-1' };
  assert.equal(isMatchingCreatedRoom({ id: 'room-request-1', hostId: 'host-1', createRequestId: 'request-1' }, request), true);
  assert.equal(isMatchingCreatedRoom({ id: 'room-request-2', hostId: 'host-1', createRequestId: 'request-1' }, request), false);
  assert.equal(isMatchingCreatedRoom({ id: 'room-request-1', hostId: 'host-2', createRequestId: 'request-1' }, request), false);
  assert.equal(isMatchingCreatedRoom({ id: 'room-request-1', hostId: 'host-1', createRequestId: 'request-2' }, request), false);
});

test('다른 방으로 전환 중인 background cleanup은 새 방 화면 상태를 지우지 않는다', () => {
  assert.equal(isRoomTransitionInProgress('room-old', 'room-new'), true);
  assert.equal(isRoomTransitionInProgress('room-old', ''), false);
  assert.equal(isRoomTransitionInProgress('room-old', 'room-old'), false);
});
