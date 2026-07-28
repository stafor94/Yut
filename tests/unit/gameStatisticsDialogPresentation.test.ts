import assert from 'node:assert/strict';
import test from 'node:test';
import {
  publishGameStatisticsDialogOpenHandler,
  requestGameStatisticsDialogOpen,
} from '../../src/app/flows/gameStatisticsDialogPresentation';

test('통계 팝업 열기 핸들러를 연결하고 해제한다', () => {
  let calls = 0;
  const unpublish = publishGameStatisticsDialogOpenHandler(() => { calls += 1; });
  requestGameStatisticsDialogOpen();
  assert.equal(calls, 1);
  unpublish();
  requestGameStatisticsDialogOpen();
  assert.equal(calls, 1);
});

test('이전 핸들러 cleanup이 새 핸들러를 제거하지 않는다', () => {
  let firstCalls = 0;
  let secondCalls = 0;
  const unpublishFirst = publishGameStatisticsDialogOpenHandler(() => { firstCalls += 1; });
  const unpublishSecond = publishGameStatisticsDialogOpenHandler(() => { secondCalls += 1; });
  unpublishFirst();
  requestGameStatisticsDialogOpen();
  assert.equal(firstCalls, 0);
  assert.equal(secondCalls, 1);
  unpublishSecond();
});
