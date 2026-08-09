import { test, expect } from '@playwright/test';
import { runBackDoNoMovableAutoPassQa } from '../helpers/backdo-no-movable-auto-pass.js';

test.describe('Galaxy 온라인 빽도 no-movable 자동 패스', () => {
  test.setTimeout(120_000);

  test('412×915에서 판 위 말이 0개인 actor의 빽도는 조작 없이 한 번만 소비된다', async ({ browser, page, context }, testInfo) => {
    expect(page.viewportSize()).toEqual({ width: 412, height: 915 });
    await runBackDoNoMovableAutoPassQa({ browser, page, context, testInfo });
  });
});
