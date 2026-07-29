import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getSequenceExportVisible,
  isLocalPlayerOne,
  publishSequenceExportVisible,
  subscribeSequenceExportVisible,
} from '../../src/app/flows/gameHeaderActionsPresentation';
import {
  publishGameGuideDialogOpenHandler,
  requestGameGuideDialogOpen,
} from '../../src/app/flows/gameGuideDialogPresentation';

const seats = [
  { id: 'host', label: 'P1' },
  { id: 'guest', label: 'P2' },
];

test('Sequence Export는 P1 좌석 사용자에게만 표시한다', () => {
  assert.equal(isLocalPlayerOne(seats, 'host'), true);
  assert.equal(isLocalPlayerOne(seats, 'guest'), false);
  assert.equal(isLocalPlayerOne(seats, ''), false);
});

test('P1 라벨이 없는 이전 좌석 데이터는 첫 좌석을 P1로 사용한다', () => {
  assert.equal(isLocalPlayerOne([{ id: 'legacy-host' }, { id: 'legacy-guest' }], 'legacy-host'), true);
  assert.equal(isLocalPlayerOne([{ id: 'legacy-host' }, { id: 'legacy-guest' }], 'legacy-guest'), false);
});

test('Sequence Export 표시 변경을 구독자에게 한 번만 알린다', () => {
  publishSequenceExportVisible(false);
  let calls = 0;
  const unsubscribe = subscribeSequenceExportVisible(() => { calls += 1; });
  publishSequenceExportVisible(true);
  publishSequenceExportVisible(true);
  assert.equal(getSequenceExportVisible(), true);
  assert.equal(calls, 1);
  unsubscribe();
  publishSequenceExportVisible(false);
  assert.equal(calls, 1);
});

test('게임 방법 팝업 열기 핸들러를 연결하고 해제한다', () => {
  let calls = 0;
  const unpublish = publishGameGuideDialogOpenHandler(() => { calls += 1; });
  requestGameGuideDialogOpen();
  assert.equal(calls, 1);
  unpublish();
  requestGameGuideDialogOpen();
  assert.equal(calls, 1);
});

test('이전 게임 방법 핸들러 cleanup이 새 핸들러를 제거하지 않는다', () => {
  let firstCalls = 0;
  let secondCalls = 0;
  const unpublishFirst = publishGameGuideDialogOpenHandler(() => { firstCalls += 1; });
  const unpublishSecond = publishGameGuideDialogOpenHandler(() => { secondCalls += 1; });
  unpublishFirst();
  requestGameGuideDialogOpen();
  assert.equal(firstCalls, 0);
  assert.equal(secondCalls, 1);
  unpublishSecond();
});
