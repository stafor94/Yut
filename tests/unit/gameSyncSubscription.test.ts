import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createGameSyncSubscriptionController,
  getGameSyncSnapshotApplyKey,
  type GameSyncRuntime,
  type GameSyncSnapshotIdentity,
} from '../../src/app/hooks/gameSyncSubscription.js';

type TestSnapshot = GameSyncSnapshotIdentity & { value?: string };

const flushController = () => new Promise<void>((resolve) => setImmediate(resolve));
const wait = (delayMs: number) => new Promise<void>((resolve) => setTimeout(resolve, delayMs));
const missingEmitter = () => { throw new Error('구독 callback이 등록되지 않았습니다.'); };

const createRuntime = (
  roomId: string,
  counters: { replay: number; apply: number; enqueue: number },
  refs: { sequence: { current: number }; version: { current: number }; applying: { current: boolean } },
): GameSyncRuntime<TestSnapshot> => ({
  activeRoomId: roomId,
  lastAppliedSequenceRef: refs.sequence,
  lastAppliedStateVersionRef: refs.version,
  applyingSyncedStateRef: refs.applying,
  replayMissingSequencesThenApply: async (_state, _localSequence, remoteSequence) => {
    counters.replay += 1;
    refs.sequence.current = remoteSequence;
    refs.version.current = remoteSequence;
  },
  applySyncedStateSnapshot: (state) => {
    counters.apply += 1;
    refs.sequence.current = Number(state.lastSequence ?? 0);
    refs.version.current = Number(state.turnVersion ?? 0);
  },
  enqueueAuthoritativeResultApplication: async (applyResult) => {
    counters.enqueue += 1;
    await applyResult();
  },
  scheduleApplyingReset: (reset) => reset(),
});

test('같은 방의 재렌더는 listener를 다시 만들지 않고 방 변경 때만 교체한다', () => {
  const controller = createGameSyncSubscriptionController<TestSnapshot>();
  const refs = { sequence: { current: 0 }, version: { current: 0 }, applying: { current: false } };
  const counters = { replay: 0, apply: 0, enqueue: 0 };
  const subscribedRooms: string[] = [];
  const unsubscribedRooms: string[] = [];
  const callbacks = new Map<string, (state: TestSnapshot | null) => void>();
  const subscribe = (roomId: string, callback: (state: TestSnapshot | null) => void) => {
    subscribedRooms.push(roomId);
    callbacks.set(roomId, callback);
    return () => {
      unsubscribedRooms.push(roomId);
      callbacks.delete(roomId);
    };
  };

  for (let render = 0; render < 20; render += 1) {
    controller.updateRuntime(createRuntime('room-a', counters, refs));
    controller.syncRoom('room-a', subscribe);
  }
  assert.deepEqual(subscribedRooms, ['room-a']);
  assert.deepEqual(unsubscribedRooms, []);

  const staleRoomCallback = callbacks.get('room-a');
  controller.updateRuntime(createRuntime('room-b', counters, refs));
  controller.syncRoom('room-b', subscribe);
  assert.deepEqual(subscribedRooms, ['room-a', 'room-b']);
  assert.deepEqual(unsubscribedRooms, ['room-a']);

  staleRoomCallback?.({ turnVersion: 1, lastSequence: 1 });
  assert.equal(counters.enqueue, 0);

  controller.dispose();
  assert.deepEqual(unsubscribedRooms, ['room-a', 'room-b']);
});

test('Strict Mode cleanup 뒤 runtime을 재주입하면 listener 처리가 정상 재개된다', async () => {
  const controller = createGameSyncSubscriptionController<TestSnapshot>();
  const refs = { sequence: { current: 0 }, version: { current: 0 }, applying: { current: false } };
  const counters = { replay: 0, apply: 0, enqueue: 0 };
  const subscribedRooms: string[] = [];
  const unsubscribedRooms: string[] = [];
  let emit: (state: TestSnapshot | null) => void = missingEmitter;
  const subscribe = (roomId: string, callback: (state: TestSnapshot | null) => void) => {
    subscribedRooms.push(roomId);
    emit = callback;
    return () => { unsubscribedRooms.push(roomId); };
  };
  const runtime = createRuntime('room-a', counters, refs);

  controller.updateRuntime(runtime);
  controller.syncRoom('room-a', subscribe);
  controller.dispose();
  controller.updateRuntime(runtime);
  controller.syncRoom('room-a', subscribe);

  emit({ turnVersion: 1, lastSequence: 1, value: 'after-strict-cleanup' });
  await flushController();

  assert.deepEqual(subscribedRooms, ['room-a', 'room-a']);
  assert.deepEqual(unsubscribedRooms, ['room-a']);
  assert.equal(counters.replay, 1);
  assert.equal(counters.enqueue, 1);
});

test('동일 snapshot은 한 번만 적용하고 새 sequence는 즉시 replay한다', async () => {
  const controller = createGameSyncSubscriptionController<TestSnapshot>();
  const refs = { sequence: { current: 0 }, version: { current: 0 }, applying: { current: false } };
  const counters = { replay: 0, apply: 0, enqueue: 0 };
  let emit: (state: TestSnapshot | null) => void = missingEmitter;

  controller.updateRuntime(createRuntime('room-a', counters, refs));
  controller.syncRoom('room-a', (_roomId, callback) => {
    emit = callback;
    return () => undefined;
  });

  emit({ turnVersion: 1, lastSequence: 1, value: 'first' });
  emit({ turnVersion: 1, lastSequence: 1, value: 'first' });
  await flushController();
  assert.equal(counters.replay, 1);
  assert.equal(counters.enqueue, 1);

  emit({ turnVersion: 1, lastSequence: 1, value: 'first' });
  await flushController();
  assert.equal(counters.replay, 1);
  assert.equal(counters.enqueue, 1);

  emit({ turnVersion: 2, lastSequence: 2, value: 'second' });
  await flushController();
  assert.equal(counters.replay, 2);
  assert.equal(counters.enqueue, 2);

  emit({ turnVersion: 1, lastSequence: 1, value: 'first' });
  await flushController();
  assert.equal(counters.replay, 2);
  assert.equal(counters.enqueue, 2);
  assert.equal(refs.sequence.current, 2);
  assert.equal(refs.version.current, 2);
  assert.equal(refs.applying.current, false);
});

test('누락된 여러 sequence는 렌더 경계를 두고 한 건씩 replay한다', async () => {
  const controller = createGameSyncSubscriptionController<TestSnapshot>();
  const refs = { sequence: { current: 3 }, version: { current: 3 }, applying: { current: false } };
  const counters = { replay: 0, apply: 0, enqueue: 0 };
  const replayRanges: Array<[number, number]> = [];
  let emit: (state: TestSnapshot | null) => void = missingEmitter;

  const runtime: GameSyncRuntime<TestSnapshot> = {
    ...createRuntime('room-a', counters, refs),
    replayMissingSequencesThenApply: async (_state, localSequence, remoteSequence) => {
      replayRanges.push([localSequence, remoteSequence]);
      refs.sequence.current = remoteSequence;
      refs.version.current = remoteSequence;
    },
  };
  controller.updateRuntime(runtime);
  controller.syncRoom('room-a', (_roomId, callback) => {
    emit = callback;
    return () => undefined;
  });

  emit({ turnVersion: 6, lastSequence: 6, value: 'three-missing-sequences' });
  await wait(30);
  await flushController();

  assert.deepEqual(replayRanges, [[3, 4], [4, 5], [5, 6]]);
  assert.equal(counters.enqueue, 1);
  assert.equal(refs.sequence.current, 6);
  assert.equal(refs.applying.current, false);
});

test('사전 준비 snapshot은 공통 카운트다운 종료 시점까지 적용을 보류한다', async () => {
  const controller = createGameSyncSubscriptionController<TestSnapshot>();
  const refs = { sequence: { current: 0 }, version: { current: 0 }, applying: { current: false } };
  const counters = { replay: 0, apply: 0, enqueue: 0 };
  let emit: (state: TestSnapshot | null) => void = missingEmitter;

  controller.updateRuntime(createRuntime('room-a', counters, refs));
  controller.syncRoom('room-a', (_roomId, callback) => {
    emit = callback;
    return () => undefined;
  });

  emit({
    turnVersion: 1,
    lastSequence: 1,
    startRequestVersion: 3,
    startRequestId: 'request-3',
    startCountdownEndsAt: Date.now() + 40,
    value: 'prepared',
  });
  await flushController();
  assert.equal(counters.replay, 0);
  assert.equal(counters.enqueue, 0);

  await wait(80);
  await flushController();
  assert.equal(counters.replay, 1);
  assert.equal(counters.enqueue, 1);
  controller.dispose();
});

test('turnVersion이 없는 legacy snapshot도 안정적인 payload key로 중복 적용을 막는다', async () => {
  const controller = createGameSyncSubscriptionController<TestSnapshot>();
  const refs = { sequence: { current: 0 }, version: { current: 0 }, applying: { current: false } };
  const counters = { replay: 0, apply: 0, enqueue: 0 };
  let emit: (state: TestSnapshot | null) => void = missingEmitter;

  controller.updateRuntime(createRuntime('room-a', counters, refs));
  controller.syncRoom('room-a', (_roomId, callback) => {
    emit = callback;
    return () => undefined;
  });

  const makeLegacySnapshot = (value: string) => ({
    turnVersion: 0,
    lastSequence: 0,
    updatedAt: { toMillis: () => 1000 },
    value,
  });
  emit(makeLegacySnapshot('same'));
  emit(makeLegacySnapshot('same'));
  await flushController();
  assert.equal(counters.apply, 1);

  emit(makeLegacySnapshot('changed'));
  await flushController();
  assert.equal(counters.apply, 2);
  assert.notEqual(getGameSyncSnapshotApplyKey(makeLegacySnapshot('same')), getGameSyncSnapshotApplyKey(makeLegacySnapshot('changed')));
});
