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

const createRuntime = (
  roomId: string,
  counters: { replay: number; apply: number; enqueue: number },
  refs: { sequence: { current: number }; version: { current: number }; applying: { current: boolean } },
): GameSyncRuntime<TestSnapshot> => ({
  activeRoomId: roomId,
  lastAppliedSequenceRef: refs.sequence,
  lastAppliedStateVersionRef: refs.version,
  applyingSyncedStateRef: refs.applying,
  replayMissingSequencesThenApply: async (state) => {
    counters.replay += 1;
    refs.sequence.current = Number(state.lastSequence ?? 0);
    refs.version.current = Number(state.turnVersion ?? 0);
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

test('동일 snapshot은 한 번만 적용하고 새 sequence는 즉시 replay한다', async () => {
  const controller = createGameSyncSubscriptionController<TestSnapshot>();
  const refs = { sequence: { current: 0 }, version: { current: 0 }, applying: { current: false } };
  const counters = { replay: 0, apply: 0, enqueue: 0 };
  let emit: ((state: TestSnapshot | null) => void) | null = null;

  controller.updateRuntime(createRuntime('room-a', counters, refs));
  controller.syncRoom('room-a', (_roomId, callback) => {
    emit = callback;
    return () => undefined;
  });

  emit?.({ turnVersion: 1, lastSequence: 1, value: 'first' });
  emit?.({ turnVersion: 1, lastSequence: 1, value: 'first' });
  await flushController();
  assert.equal(counters.replay, 1);
  assert.equal(counters.enqueue, 1);

  emit?.({ turnVersion: 1, lastSequence: 1, value: 'first' });
  await flushController();
  assert.equal(counters.replay, 1);
  assert.equal(counters.enqueue, 1);

  emit?.({ turnVersion: 2, lastSequence: 2, value: 'second' });
  await flushController();
  assert.equal(counters.replay, 2);
  assert.equal(refs.sequence.current, 2);
  assert.equal(refs.version.current, 2);
  assert.equal(refs.applying.current, false);
});

test('turnVersion이 없는 legacy snapshot도 안정적인 payload key로 중복 적용을 막는다', async () => {
  const controller = createGameSyncSubscriptionController<TestSnapshot>();
  const refs = { sequence: { current: 0 }, version: { current: 0 }, applying: { current: false } };
  const counters = { replay: 0, apply: 0, enqueue: 0 };
  let emit: ((state: TestSnapshot | null) => void) | null = null;

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
  emit?.(makeLegacySnapshot('same'));
  emit?.(makeLegacySnapshot('same'));
  await flushController();
  assert.equal(counters.apply, 1);

  emit?.(makeLegacySnapshot('changed'));
  await flushController();
  assert.equal(counters.apply, 2);
  assert.notEqual(getGameSyncSnapshotApplyKey(makeLegacySnapshot('same')), getGameSyncSnapshotApplyKey(makeLegacySnapshot('changed')));
});
