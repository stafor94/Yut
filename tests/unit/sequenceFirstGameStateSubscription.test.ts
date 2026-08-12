import assert from 'node:assert/strict';
import test from 'node:test';
import type { SyncedGameState } from '../../src/features/room/services/roomService.js';
import { advanceSequenceFirstState } from '../../src/app/hooks/sequenceFirstGameState.js';
import {
  createSequenceFirstGameStateSubscriber,
  matchesCurrentRoomStartRevision,
} from '../../src/app/hooks/sequenceFirstGameStateSubscription.js';
import {
  getGameConnectionPresentation,
  shouldRecoverGameConnectionOnResume,
} from '../../src/app/hooks/gameConnectionState.js';

const makeSyncedState = (startRequestVersion: number, startRequestId: string): SyncedGameState => ({
  pieces: [],
  turnIndex: 0,
  roll: null,
  boardItems: [],
  ownedItems: {},
  trapNodes: [],
  shieldedPieceIds: [],
  logs: [],
  winner: '',
  turnVersion: 1,
  lastSequence: 1,
  startRequestVersion,
  startRequestId,
});

const flushAsyncWork = () => new Promise<void>((resolve) => setImmediate(resolve));

test('연속 sequence patch는 snapshot 조회 없이 현재 상태에 적용한다', () => {
  const advanced = advanceSequenceFirstState({
    turnIndex: 0,
    logs: [],
    turnVersion: 4,
    lastSequence: 4,
    lastClientMutationId: '',
  }, [{
    id: '000000000005',
    sequence: 5,
    patch: { turnIndex: 1 },
    logEntries: [{ id: 5, text: '원격 액션' }],
    clientMutationId: 'remote-5',
  }]);

  assert.equal(advanced.status, 'applied');
  assert.equal(advanced.state.lastSequence, 5);
  assert.equal(advanced.state.turnIndex, 1);
  assert.equal(advanced.state.lastClientMutationId, 'remote-5');
});

test('sequence gap은 patch를 추측하지 않고 snapshot 복구를 요구한다', () => {
  const advanced = advanceSequenceFirstState({ lastSequence: 4 }, [{
    sequence: 6,
    patch: { turnIndex: 2 },
  }]);
  assert.equal(advanced.status, 'recovery-required');
  assert.equal(advanced.state?.lastSequence, 4);
});

test('현재 room start revision과 다른 game state는 승인하지 않는다', () => {
  const roomStart = { startRequestVersion: 4, startRequestId: 'request-4' };
  assert.equal(matchesCurrentRoomStartRevision(roomStart, makeSyncedState(3, 'request-3')), false);
  assert.equal(matchesCurrentRoomStartRevision(roomStart, makeSyncedState(4, 'request-4')), true);
});

test('초기 stale game-start snapshot은 callback과 sequence listener를 건드리지 않고 현재 revision을 다시 읽는다', async () => {
  const staleState = makeSyncedState(3, 'request-3');
  const currentState = makeSyncedState(4, 'request-4');
  const delivered: Array<SyncedGameState | null> = [];
  const timers = new Map<number, { callback: () => void; delayMs: number }>();
  let timerId = 0;
  let latestStateReads = 0;
  let sequenceSubscriptions = 0;

  const subscriber = createSequenceFirstGameStateSubscriber({
    getLatestState: async () => {
      latestStateReads += 1;
      return latestStateReads === 1 ? staleState : currentState;
    },
    getCurrentRoomStart: async () => ({ startRequestVersion: 4, startRequestId: 'request-4' }),
    subscribeSequences: () => {
      sequenceSubscriptions += 1;
      return () => undefined;
    },
    setTimeout: (callback, delayMs) => {
      const nextId = ++timerId;
      timers.set(nextId, { callback, delayMs });
      return nextId as unknown as ReturnType<typeof globalThis.setTimeout>;
    },
    clearTimeout: (timer) => {
      timers.delete(timer as unknown as number);
    },
  });

  const unsubscribe = subscriber('room-a', (state) => delivered.push(state));
  await flushAsyncWork();
  await flushAsyncWork();

  assert.equal(latestStateReads, 1);
  assert.deepEqual(delivered, []);
  assert.equal(sequenceSubscriptions, 0);

  const retry = [...timers.entries()].find(([, timer]) => timer.delayMs === 1_000);
  assert.ok(retry);
  timers.delete(retry[0]);
  retry[1].callback();
  await flushAsyncWork();
  await flushAsyncWork();

  assert.equal(latestStateReads, 2);
  assert.deepEqual(delivered, [currentState]);
  assert.equal(sequenceSubscriptions, 1);
  unsubscribe();
});

test('연결 상태 표시는 복구 상태를 구분하고 오래된 서버 확인만 resume 복구한다', () => {
  assert.deepEqual(getGameConnectionPresentation({
    roomId: 'room-a',
    status: 'recovering',
    lastServerConfirmedAt: 0,
    hasPendingWrites: false,
  }), { label: '복구 중', tone: 'pending' });
  assert.equal(shouldRecoverGameConnectionOnResume({
    roomId: 'room-a',
    status: 'online',
    lastServerConfirmedAt: 99_000,
    hasPendingWrites: false,
  }, 'room-a', 100_000, 30_000), false);
  assert.equal(shouldRecoverGameConnectionOnResume({
    roomId: 'room-a',
    status: 'online',
    lastServerConfirmedAt: 60_000,
    hasPendingWrites: false,
  }, 'room-a', 100_000, 30_000), true);
});
