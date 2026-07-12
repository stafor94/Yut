import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createGameSyncSubscriptionController,
  type GameSyncRuntime,
  type GameSyncSnapshotIdentity,
} from '../../src/app/hooks/gameSyncSubscription.js';

type TestSnapshot = GameSyncSnapshotIdentity & { value?: string };

const flushController = () => new Promise<void>((resolve) => setImmediate(resolve));

test('중복 snapshot도 listener activity callback은 매번 호출하지만 상태 적용은 한 번만 한다', async () => {
  const controller = createGameSyncSubscriptionController<TestSnapshot>();
  const refs = { sequence: { current: 0 }, version: { current: 0 }, applying: { current: false } };
  let snapshotActivities = 0;
  let replayCount = 0;
  let enqueueCount = 0;
  let emit: (state: TestSnapshot | null) => void = () => undefined;

  const runtime: GameSyncRuntime<TestSnapshot> = {
    activeRoomId: 'room-a',
    lastAppliedSequenceRef: refs.sequence,
    lastAppliedStateVersionRef: refs.version,
    applyingSyncedStateRef: refs.applying,
    replayMissingSequencesThenApply: async (state) => {
      replayCount += 1;
      refs.sequence.current = Number(state.lastSequence ?? 0);
      refs.version.current = Number(state.turnVersion ?? 0);
    },
    applySyncedStateSnapshot: () => undefined,
    enqueueAuthoritativeResultApplication: async (applyResult) => {
      enqueueCount += 1;
      await applyResult();
    },
    scheduleApplyingReset: (reset) => reset(),
    onSnapshotReceived: () => {
      snapshotActivities += 1;
    },
  };

  controller.updateRuntime(runtime);
  controller.syncRoom('room-a', (_roomId, callback) => {
    emit = callback;
    return () => undefined;
  });

  const snapshot = { turnVersion: 1, lastSequence: 1, value: 'same' };
  emit(snapshot);
  emit(snapshot);
  await flushController();

  assert.equal(snapshotActivities, 2);
  assert.equal(replayCount, 1);
  assert.equal(enqueueCount, 1);
});
