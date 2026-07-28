import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildGameStatisticsRollGroups,
  getVisibleTimingStatistics,
  type GameStatisticsBreakdown,
  type PlayerRollStatisticsRecord,
  type TimingStatLabel,
} from '../../src/app/flows/gameStatistics';

const record = (sequence: number): PlayerRollStatisticsRecord => ({
  sequence,
  timing: 'PERFECT',
  result: '도',
});

const summarizeGroups = (sequences: readonly number[]) => buildGameStatisticsRollGroups(
  sequences.map(record),
).map((group) => group.records.map((entry) => entry.sequence));

test('통계 기록은 6열로 묶고 최신 행을 위에 두며 부분 행도 왼쪽부터 배치한다', () => {
  assert.deepEqual(summarizeGroups([]), []);
  assert.deepEqual(summarizeGroups([1]), [[1]]);
  assert.deepEqual(summarizeGroups([5, 3, 1, 4, 2]), [[1, 2, 3, 4, 5]]);
  assert.deepEqual(summarizeGroups([6, 4, 2, 5, 3, 1]), [[1, 2, 3, 4, 5, 6]]);
  assert.deepEqual(summarizeGroups([7, 6, 5, 4, 3, 2, 1]), [
    [7],
    [1, 2, 3, 4, 5, 6],
  ]);
  assert.deepEqual(summarizeGroups(Array.from({ length: 40 }, (_, index) => 40 - index)), [
    [37, 38, 39, 40],
    [31, 32, 33, 34, 35, 36],
    [25, 26, 27, 28, 29, 30],
    [19, 20, 21, 22, 23, 24],
    [13, 14, 15, 16, 17, 18],
    [7, 8, 9, 10, 11, 12],
    [1, 2, 3, 4, 5, 6],
  ]);
});

test('잘못된 열 수는 기본 6열로 복구하고 유효한 열 수는 그대로 적용한다', () => {
  assert.deepEqual(buildGameStatisticsRollGroups(Array.from({ length: 7 }, (_, index) => record(index + 1)), 0), [
    { records: [record(7)] },
    { records: [record(1), record(2), record(3), record(4), record(5), record(6)] },
  ]);
  assert.deepEqual(buildGameStatisticsRollGroups([record(1), record(2), record(3)], 2), [
    { records: [record(3)] },
    { records: [record(1), record(2)] },
  ]);
});

test('타이밍 통계는 PERFECT·NICE·GOOD·BAD 네 항목을 항상 유지하고 실제 미확인만 별도 표시한다', () => {
  const withoutUnknown: GameStatisticsBreakdown<TimingStatLabel>[] = [
    { label: 'PERFECT', count: 1, percentage: 25 },
    { label: 'NICE', count: 1, percentage: 25 },
    { label: 'GOOD', count: 1, percentage: 25 },
    { label: 'BAD', count: 1, percentage: 25 },
    { label: '미확인', count: 0, percentage: 0 },
  ];
  const visibleWithoutUnknown = getVisibleTimingStatistics(withoutUnknown);
  assert.deepEqual(visibleWithoutUnknown.primary.map((entry) => entry.label), ['PERFECT', 'NICE', 'GOOD', 'BAD']);
  assert.equal(visibleWithoutUnknown.unknown, null);

  const visibleWithUnknown = getVisibleTimingStatistics([
    ...withoutUnknown.slice(0, -1),
    { label: '미확인', count: 2, percentage: 33.3 },
  ]);
  assert.deepEqual(visibleWithUnknown.unknown, { label: '미확인', count: 2, percentage: 33.3 });
});
