import assert from 'node:assert/strict';
import test from 'node:test';
import { publishGameEndDialogOpenHandler, requestGameEndDialogOpen } from '../../src/app/flows/gameEndDialogPresentation';

test('헤더 종료 요청은 현재 게임 종료 다이얼로그 핸들러를 호출한다', () => {
  let openCount = 0;
  const cleanup = publishGameEndDialogOpenHandler(() => {
    openCount += 1;
  });

  requestGameEndDialogOpen();
  assert.equal(openCount, 1);

  cleanup();
  requestGameEndDialogOpen();
  assert.equal(openCount, 1);
});
