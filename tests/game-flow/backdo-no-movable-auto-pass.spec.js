import { test } from '@playwright/test';
import { runBackDoNoMovableAutoPassQa } from '../helpers/backdo-no-movable-auto-pass.js';

test.describe('온라인 빽도 no-movable 자동 패스', () => {
  test.setTimeout(120_000);

  test('판 위 말이 0개인 actor의 빽도는 사용자 조작 없이 정확히 한 번 소비되어 다음 턴으로 수렴한다', async ({ browser, page, context }, testInfo) => {
    await runBackDoNoMovableAutoPassQa({ browser, page, context, testInfo });
  });
});
