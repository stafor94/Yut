import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clearCachedGameSequences,
  getCachedGameSequencesForReplay,
  hasCachedGameSequence,
  replaceCachedGameSequences,
  withGameSequenceReplayCache,
} from '../../src/features/room/services/roomSequenceReplayCache.js';

test('snapshot replay 대상 범위가 연속으로 캐시되어 있으면 Firestore 조회 없이 반환한다', async () => {
  const roomId = 'room-inline-range';
  replaceCachedGameSequences(roomId, [
    { sequence: 7, value: 'seven' },
    { sequence: 8, value: 'eight' },
    { sequence: 9, value: 'nine' },
  ]);

  const cached = await withGameSequenceReplayCache(roomId, 7, 9, async () => (
    getCachedGameSequencesForReplay<{ sequence: number; value: string }>(roomId, 5)
  ));

  assert.deepEqual(cached?.map((sequence) => sequence.sequence), [8, 9]);
  assert.equal(hasCachedGameSequence(roomId, 9), true);
  clearCachedGameSequences(roomId);
});

test('replay 범위 중 한 건이라도 없으면 기존 Firestore 조회 fallback을 사용하도록 null을 반환한다', async () => {
  const roomId = 'room-cache-gap';
  replaceCachedGameSequences(roomId, [
    { sequence: 8 },
    { sequence: 10 },
  ]);

  const cached = await withGameSequenceReplayCache(roomId, 7, 10, async () => (
    getCachedGameSequencesForReplay(roomId, 5)
  ));

  assert.equal(cached, null);
  clearCachedGameSequences(roomId);
});

test('snapshot replay scope 밖의 일반 sequence 조회는 캐시를 사용하지 않는다', () => {
  const roomId = 'room-no-replay-scope';
  replaceCachedGameSequences(roomId, [{ sequence: 3 }]);
  assert.equal(getCachedGameSequencesForReplay(roomId, 0), null);
  clearCachedGameSequences(roomId);
});

test('동일 방 replay scope가 겹쳐도 각 비동기 작업의 최신 target을 분리한다', async () => {
  const roomId = 'room-overlapping-scope';
  replaceCachedGameSequences(roomId, [
    { sequence: 4 },
    { sequence: 5 },
    { sequence: 6 },
  ]);

  let releaseOuter: (() => void) | undefined;
  const outerPause = new Promise<void>((resolve) => { releaseOuter = resolve; });
  const outer = withGameSequenceReplayCache(roomId, 3, 5, async () => {
    await outerPause;
    return getCachedGameSequencesForReplay<{ sequence: number }>(roomId, 1)?.map((sequence) => sequence.sequence);
  });
  const inner = await withGameSequenceReplayCache(roomId, 5, 6, async () => (
    getCachedGameSequencesForReplay<{ sequence: number }>(roomId, 3)?.map((sequence) => sequence.sequence)
  ));
  releaseOuter?.();

  assert.deepEqual(inner, [6]);
  assert.deepEqual(await outer, [4, 5]);
  clearCachedGameSequences(roomId);
});
