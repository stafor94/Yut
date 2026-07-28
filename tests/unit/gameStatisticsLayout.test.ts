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
).map((group) => ({
  sequences: group.records.map((entry) => entry.sequence),
  leadingEmptyColumns: group.leadingEmptyColumns,
}));

test('통계 기록은 최신 행이 위에 오고 각 행은 왼쪽에서 오른쪽으로 Sequence가 증가한다', () => {
  assert.deepEqual(summarizeGroups([]), []);
  assert.deepEqual(summarizeGroups([1]), [
    { sequences: [1], leadingEmptyColumns: 2 },
  ]);
  assert.deepEqual(summarizeGroups([2, 1]), [
    { sequences: [1, 2], leadingEmptyColumns: 1 },
  ]);
  assert.deepEqual(summarizeGroups([3, 1, 2]), [
    { sequences: [1, 2, 3], leadingEmptyColumns: 0 },
  ]);
  assert.deepEqual(summarizeGroups([4, 3, 2, 1]), [
    { sequences: [4], leadingEmptyColumns: 2 },
    { sequences: [1, 2, 3], leadingEmptyColumns: 0 },
  ]);
  assert.deepEqual(summarizeGroups([5, 4, 3, 2, 1]), [
    { sequences: [4, 5], leadingEmptyColumns: 1 },
    { sequences: [1, 2, 3], leadingEmptyColumns: 0 },
  ]);
  assert.deepEqual(summarizeGroups([7, 6, 5, 4, 3, 2, 1]), [
    { sequences: [7], leadingEmptyColumns: 2 },
    { sequences: [4, 5, 6], leadingEmptyColumns: 0 },
    { sequences: [1, 2, 3], leadingEmptyColumns: 0 },
  ]);
});

test('잘못된 열 수는 기본 3열로 복구하고 유효한 열 수는 그대로 적용한다', () => {
  assert.deepEqual(buildGameStatisticsRollGroups([record(1), record(2), record(3), record(4)], 0), [
    { records: [record(4)], leadingEmptyColumns: 2 },
    { records: [record(1), record(2), record(3)], leadingEmptyColumns: 0 },
  ]);
  assert.deepEqual(buildGameStatisticsRollGroups([record(1), record(2), record(3)], 2), [
    { records: [record(3)], leadingEmptyColumns: 1 },
    { records: [record(1), record(2)], leadingEmptyColumns: 0 },
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
