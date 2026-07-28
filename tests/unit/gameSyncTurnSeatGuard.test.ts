import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createGameSyncSubscriptionController,
  hasCompleteAuthoritativeTurnSeatSnapshot,
  type GameSyncRuntime,
  type GameSyncSnapshotIdentity,
} from '../../src/app/hooks/gameSyncSubscription.js';

type TestSnapshot = GameSyncSnapshotIdentity & {
  turnOrderIds?: string[];
  gameSeats?: Array<{ id: string; name?: string }>;
};

const flushController = () => new Promise<void>((resolve) => setImmediate(resolve));

test('authoritative turnOrderIds의 모든 ID가 gameSeats에 있어야 snapshot을 완성 상태로 본다', () => {
  assert.equal(hasCompleteAuthoritativeTurnSeatSnapshot({}), true);
  assert.equal(hasCompleteAuthoritativeTurnSeatSnapshot({ turnOrderIds: [] }), true);
  assert.equal(hasCompleteAuthoritativeTurnSeatSnapshot({
    turnOrderIds: ['p1', 'p2'],
    gameSeats: [{ id: 'p2' }],
  }), false);
  assert.equal(hasCompleteAuthoritativeTurnSeatSnapshot({
    turnOrderIds: ['p1', 'p2'],
    gameSeats: [{ id: 'p2' }, { id: 'p1' }],
  }), true);
});

test('부분 gameSeats snapshot은 적용하지 않고 완성 snapshot이 도착한 뒤 같은 turnIndex를 적용한다', async () => {
  const controller = createGameSyncSubscriptionController<TestSnapshot>();
  const refs = {
    sequence: { current: 0 },
    version: { current: 0 },
    applying: { current: false },
  };
  const counters = { replay: 0, apply: 0, enqueue: 0 };
  const appliedSnapshots: TestSnapshot[] = [];
  let emit: (state: TestSnapshot | null) => void = () => {
    throw new Error('구독 callback이 등록되지 않았습니다.');
  };

  const runtime: GameSyncRuntime<TestSnapshot> = {
    activeRoomId: 'room-a',
    lastAppliedSequenceRef: refs.sequence,
    lastAppliedStateVersionRef: refs.version,
    applyingSyncedStateRef: refs.applying,
    replayMissingSequencesThenApply: async (state, _localSequence, remoteSequence) => {
      counters.replay += 1;
      appliedSnapshots.push(state);
      refs.sequence.current = remoteSequence;
      refs.version.current = Number(state.turnVersion ?? remoteSequence);
    },
    applySyncedStateSnapshot: (state) => {
      counters.apply += 1;
      appliedSnapshots.push(state);
      refs.sequence.current = Number(state.lastSequence ?? 0);
      refs.version.current = Number(state.turnVersion ?? 0);
    },
    enqueueAuthoritativeResultApplication: async (applyResult) => {
      counters.enqueue += 1;
      await applyResult();
    },
    scheduleApplyingReset: (reset) => reset(),
  };

  controller.updateRuntime(runtime);
  controller.syncRoom('room-a', (_roomId, callback) => {
    emit = callback;
    return () => undefined;
  });

  emit({
    turnVersion: 8,
    lastSequence: 8,
    turnOrderIds: ['p1', 'p2'],
    gameSeats: [{ id: 'p2', name: '둘째' }],
  });
  await flushController();

  assert.deepEqual(counters, { replay: 0, apply: 0, enqueue: 0 });
  assert.equal(refs.sequence.current, 0);
  assert.equal(refs.version.current, 0);
  assert.equal(refs.applying.current, false);

  emit({
    turnVersion: 8,
    lastSequence: 8,
    turnOrderIds: ['p1', 'p2'],
    gameSeats: [{ id: 'p1', name: '첫째' }, { id: 'p2', name: '둘째' }],
  });
  await flushController();

  assert.deepEqual(counters, { replay: 1, apply: 0, enqueue: 1 });
  assert.equal(refs.sequence.current, 8);
  assert.equal(refs.version.current, 8);
  assert.deepEqual(appliedSnapshots[0]?.turnOrderIds, ['p1', 'p2']);
  assert.deepEqual(appliedSnapshots[0]?.gameSeats?.map((seat) => seat.id), ['p1', 'p2']);
  assert.equal(refs.applying.current, false);

  controller.dispose();
});
