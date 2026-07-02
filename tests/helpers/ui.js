import { expect } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';

export const consoleLogPath = path.join(process.cwd(), 'console-log.txt');

export async function appendQaLog(testInfo, status, step, details = '') {
  const suffix = details ? ` - ${details}` : '';
  await fs.appendFile(consoleLogPath, `[${new Date().toISOString()}] [${testInfo.project.name}] [${status}] ${step}${suffix}\n`);
}

export async function runQaStep(testInfo, step, action) {
  await appendQaLog(testInfo, 'START', step);
  return testInfo.attach ? await actionWithLogging(testInfo, step, action) : action();
}

async function actionWithLogging(testInfo, step, action) {
  try {
    const result = await action();
    await appendQaLog(testInfo, 'PASS', step);
    return result;
  } catch (error) {
    await appendQaLog(testInfo, 'FAIL', step, error instanceof Error ? error.stack || error.message : String(error));
    throw error;
  }
}

export function attachConsoleErrorCapture(page, consoleErrors) {
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(error.message));
}

export function isAllowedConsoleError(message) {
  return (
    /Failed to load resource: the server responded with a status of (400|409)/.test(message) ||
    (/firestore/i.test(message) && /(Commit|already-exists|400|409)/i.test(message))
  );
}

export function expectNoBlockingConsoleErrors(consoleErrors) {
  const blockingErrors = consoleErrors.filter((message) => !isAllowedConsoleError(message));
  expect(blockingErrors, `Console/page errors:\n${blockingErrors.join('\n')}`).toEqual([]);
}

export async function collectScreenState(page) {
  return page.evaluate(() => ({
    url: window.location.href,
    visibleScreens: {
      lobby: Boolean(document.querySelector('[data-testid="lobby-screen"]')),
      waitingRoom: Boolean(document.querySelector('[data-testid="waiting-room"]')),
      game: Boolean(document.querySelector('[data-testid="game-screen"]')),
    },
    appShellText: document.querySelector('[data-testid="app-shell"]')?.textContent?.trim().slice(0, 1000) ?? '',
    waitingRoomText: document.querySelector('[data-testid="waiting-room"]')?.textContent?.trim().slice(0, 1000) ?? '',
    gameText: document.querySelector('[data-testid="game-screen"]')?.textContent?.trim().slice(0, 1000) ?? '',
    rollButton: {
      visible: Boolean(document.querySelector('[data-testid="roll-yut-button"]')),
      disabled: Boolean(document.querySelector('[data-testid="roll-yut-button"]')?.hasAttribute('disabled')),
      text: document.querySelector('[data-testid="roll-yut-button"]')?.textContent?.trim() ?? '',
    },
    moveButton: {
      visible: Boolean(document.querySelector('[data-testid="move-piece-button"]')),
      disabled: Boolean(document.querySelector('[data-testid="move-piece-button"]')?.hasAttribute('disabled')),
      text: document.querySelector('[data-testid="move-piece-button"]')?.textContent?.trim() ?? '',
    },
    turnWaitingButton: {
      visible: Boolean(document.querySelector('[data-testid="turn-waiting-button"]')),
      text: document.querySelector('[data-testid="turn-waiting-button"]')?.textContent?.trim() ?? '',
    },
    pieces: Array.from(document.querySelectorAll('[data-testid^="piece-"]')).map((node) => ({
      testId: node.getAttribute('data-testid'),
      disabled: node.hasAttribute('disabled'),
      text: node.textContent?.trim() ?? '',
      className: node.getAttribute('class') ?? '',
    })),
    yutDebug: window.__YUT_DEBUG_STATE__ ?? null,
  }));
}

export async function expectAppShell(page) {
  await page.goto('/');
  await expect(page.getByTestId('app-shell')).toBeVisible({ timeout: 15_000 });
}

export async function primeLobbyStorage(context, { nickname, maxPlayers = '2', playMode = 'individual', itemMode = 'false', pieceCount = '4' }) {
  await context.addInitScript((values) => {
    window.localStorage.setItem('yut-online:nickname', values.nickname);
    window.localStorage.setItem('yut-online:maxPlayers', values.maxPlayers);
    window.localStorage.setItem('yut-online:playMode', values.playMode);
    window.localStorage.setItem('yut-online:itemMode', values.itemMode);
    window.localStorage.setItem('yut-online:pieceCount', values.pieceCount);
  }, { nickname, maxPlayers, playMode, itemMode, pieceCount });
}
