import { test, expect } from '@playwright/test';
import {
  getAppVersionDocumentLoadCount,
  installAppVersionDocumentLoadCounter,
  routeNewAppVersion,
} from '../helpers/app-version.js';
import { makeQaName, normalizeQaNickname } from '../helpers/env.js';
import { deleteRoomForQa, findRoomIdByTitle } from '../helpers/rooms.js';
import { primeLobbyStorage } from '../helpers/ui.js';

const appUrl = String(process.env.PLAYWRIGHT_BASE_URL ?? '').trim() || '/Yut/';

test.describe('lobby app version auto reload', () => {
  let roomId = '';
  let releasePendingVersionResponse = () => {};

  test.afterEach(async () => {
    releasePendingVersionResponse();
    releasePendingVersionResponse = () => {};
    if (roomId) await deleteRoomForQa(roomId);
    roomId = '';
  });

  test('로비에서 새 버전을 감지하면 한 번만 자동 새로고침한다', async ({ page, context }) => {
    await installAppVersionDocumentLoadCounter(context);
    await routeNewAppVersion(page, 'qa-next-lobby-version');

    await page.goto(appUrl, { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('lobby-screen')).toBeVisible({ timeout: 15_000 });
    await expect.poll(() => getAppVersionDocumentLoadCount(page), {
      timeout: 10_000,
      message: '로비에서 다른 version manifest를 감지하면 document가 정확히 한 번 다시 로드되어야 합니다.',
    }).toBe(2);

    await page.evaluate(() => {
      window.dispatchEvent(new Event('focus'));
      window.dispatchEvent(new Event('online'));
    });
    await page.waitForTimeout(750);
    expect(await getAppVersionDocumentLoadCount(page)).toBe(2);
  });

  test('로비에서 시작한 늦은 버전 응답은 대기실 진입 후 자동 새로고침하지 않는다', async ({ page, context }, testInfo) => {
    const nickname = normalizeQaNickname(makeQaName(testInfo, 'version-race-host'));
    const roomTitle = makeQaName(testInfo, 'version-race-room');
    await primeLobbyStorage(context, { nickname });
    await installAppVersionDocumentLoadCounter(context);

    let markVersionRequestStarted = () => {};
    const versionResponseReleased = new Promise((resolve) => { releasePendingVersionResponse = resolve; });
    const versionRequestStarted = new Promise((resolve) => { markVersionRequestStarted = resolve; });

    await page.route('**/version.json?version-check=*', async (route) => {
      markVersionRequestStarted();
      await versionResponseReleased;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ version: 'qa-next-waiting-room-version' }),
      }).catch(() => undefined);
    });

    await page.goto(appUrl, { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('lobby-screen')).toBeVisible({ timeout: 15_000 });
    await versionRequestStarted;

    await page.getByRole('button', { name: '방 만들기', exact: true }).click();
    await expect(page.getByRole('dialog', { name: '방 만들기' })).toBeVisible();
    await page.getByTestId('room-title-input').fill(roomTitle);
    await page.getByTestId('create-room-button').click();
    await expect(page.getByTestId('waiting-room')).toBeVisible({ timeout: 45_000 });
    roomId = await findRoomIdByTitle(roomTitle);

    releasePendingVersionResponse();
    releasePendingVersionResponse = () => {};
    await page.evaluate(() => {
      window.dispatchEvent(new Event('focus'));
      window.dispatchEvent(new Event('online'));
    });
    await page.waitForTimeout(1_000);

    expect(await getAppVersionDocumentLoadCount(page)).toBe(1);
    await expect(page.getByTestId('waiting-room')).toBeVisible();
  });
});
