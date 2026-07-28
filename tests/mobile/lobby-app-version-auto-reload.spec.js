import { test, expect } from '@playwright/test';
import {
  getAppVersionDocumentLoadCount,
  installAppVersionDocumentLoadCounter,
  routeNewAppVersion,
} from '../helpers/app-version.js';

const appUrl = String(process.env.PLAYWRIGHT_BASE_URL ?? '').trim() || '/Yut/';

test('Galaxy 로비에서도 새 버전을 감지하면 한 번만 자동 새로고침한다', async ({ page, context }) => {
  await installAppVersionDocumentLoadCounter(context);
  await routeNewAppVersion(page, 'qa-next-galaxy-lobby-version');

  await page.goto(appUrl, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('lobby-screen')).toBeVisible({ timeout: 15_000 });
  await expect.poll(() => getAppVersionDocumentLoadCount(page), {
    timeout: 10_000,
    message: 'Galaxy 로비에서 다른 version manifest를 감지하면 document가 정확히 한 번 다시 로드되어야 합니다.',
  }).toBe(2);

  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.waitForTimeout(750);
  expect(await getAppVersionDocumentLoadCount(page)).toBe(2);
});
