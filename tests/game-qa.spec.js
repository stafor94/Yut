import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';

const screenshotDir = path.join(process.cwd(), 'screenshots');
const consoleLogPath = path.join(process.cwd(), 'console-log.txt');

async function saveStepScreenshot(page, testInfo, step) {
  await fs.mkdir(screenshotDir, { recursive: true });
  const fileName = `${testInfo.project.name.replaceAll(' ', '-')}-${String(testInfo.retry)}-${step}.png`;
  await page.screenshot({ path: path.join(screenshotDir, fileName), fullPage: true });
}

test.beforeEach(async ({ page }, testInfo) => {
  await fs.mkdir(screenshotDir, { recursive: true });
  await fs.appendFile(consoleLogPath, `\n## ${testInfo.project.name} - ${testInfo.title}\n`);
  page.on('console', async (message) => {
    const line = `[${new Date().toISOString()}] [${testInfo.project.name}] ${message.type()}: ${message.text()}\n`;
    await fs.appendFile(consoleLogPath, line);
  });
});

test('mobile game QA: room creation, AI fill, start, and short autoplay', async ({ page }, testInfo) => {
  const consoleErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(error.message));

  await page.goto('/');
  await expect(page.getByTestId('app-shell')).toBeVisible();
  await saveStepScreenshot(page, testInfo, '01-lobby');

  await page.getByTestId('room-title-input').fill(`QA 자동 테스트 ${testInfo.project.name}`);
  await page.getByTestId('create-room-button').click();
  await expect(page.getByTestId('waiting-room')).toBeVisible();
  await saveStepScreenshot(page, testInfo, '02-waiting-room');

  for (const label of ['P2', 'P3', 'P4']) {
    const button = page.getByTestId(`add-ai-${label}`);
    if (await button.isVisible()) await button.click();
  }
  await expect(page.getByTestId('start-game-button')).toBeEnabled();
  await saveStepScreenshot(page, testInfo, '03-ai-filled');

  await page.getByTestId('start-game-button').click();
  await expect(page.getByTestId('game-screen')).toBeVisible({ timeout: 8_000 });
  await expect(page.getByTestId('play-timer')).toBeVisible();
  await expect(page.getByTestId('players-panel')).toContainText('P1');
  await expect(page.getByTestId('turn-indicator')).toBeVisible();
  await expect(page.getByTestId('game-board')).toBeVisible();
  await expect(page.locator('[data-testid^="piece-"]').first()).toBeVisible();
  await saveStepScreenshot(page, testInfo, '04-game-started');

  for (let turn = 1; turn <= 5; turn += 1) {
    const rollButton = page.getByTestId('roll-yut-button');
    if (await rollButton.isVisible().catch(() => false)) {
      await expect(rollButton).toBeEnabled({ timeout: 15_000 });
      await rollButton.click();
      const moveButton = page.getByTestId('move-piece-button');
      if (await moveButton.isVisible({ timeout: 4_000 }).catch(() => false)) {
        await expect(moveButton).toBeEnabled({ timeout: 15_000 });
        await moveButton.click();
      }
    }
    await expect(page.getByTestId('game-screen')).toBeVisible();
    await saveStepScreenshot(page, testInfo, `05-turn-${turn}`);
    await page.waitForTimeout(600);
  }

  expect(consoleErrors, `Console/page errors:\n${consoleErrors.join('\n')}`).toEqual([]);
});
