import { expect } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { normalizeQaNickname } from './env.js';

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
    winnerOverlay: {
      visible: Boolean(document.querySelector('[data-testid="winner-overlay"]')),
      text: document.querySelector('[data-testid="winner-overlay"]')?.textContent?.trim() ?? '',
    },
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
    continueRaceButton: {
      visible: Boolean(document.querySelector('[data-testid="continue-race-button"]')),
      disabled: Boolean(document.querySelector('[data-testid="continue-race-button"]')?.hasAttribute('disabled')),
      text: document.querySelector('[data-testid="continue-race-button"]')?.textContent?.trim() ?? '',
    },
    startButton: {
      visible: Boolean(document.querySelector('[data-testid="start-game-button"]')),
      disabled: Boolean(document.querySelector('[data-testid="start-game-button"]')?.hasAttribute('disabled')),
      text: document.querySelector('[data-testid="start-game-button"]')?.textContent?.trim() ?? '',
    },
    turnOrder: {
      phaseOverlayVisible: Boolean(document.querySelector('.turn-order-overlay')),
      introOverlayVisible: Boolean(document.querySelector('.turn-order-ready-overlay')),
      lockVisible: Boolean(document.querySelector('.turn-order-lock')),
      text: [
        document.querySelector('.turn-order-overlay')?.textContent?.trim() ?? '',
        document.querySelector('.turn-order-ready-overlay')?.textContent?.trim() ?? '',
        document.querySelector('.turn-order-lock')?.textContent?.trim() ?? '',
      ].filter(Boolean).join(' | '),
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

export async function waitForBlockingOverlayToDisappear(page, { timeout = 20_000 } = {}) {
  await expect(page.locator('.loading-modal-backdrop')).toBeHidden({ timeout });
}

export async function expectAppShell(page, { timeout = 45_000 } = {}) {
  const targetUrl = String(process.env.PLAYWRIGHT_BASE_URL ?? '').trim() || '/Yut/';
  const appShell = page.getByTestId('app-shell');

  await expect(async () => {
    const response = await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
    expect(response?.ok(), `배포된 앱 URL이 성공 응답을 반환해야 합니다: ${response?.status() ?? 'no response'}`).toBe(true);
    await expect(appShell).toBeVisible({ timeout: 5_000 });
  }).toPass({
    timeout,
    intervals: [500, 1_000, 2_000, 3_000, 5_000],
  });
}

export async function primeLobbyStorage(context, { nickname, maxPlayers = '2', playMode = 'individual', itemMode = 'false', pieceCount = '4' }) {
  const normalizedNickname = normalizeQaNickname(nickname);
  await context.addInitScript((values) => {
    window.localStorage.setItem('yut-online:nickname', values.nickname);
    window.localStorage.setItem('yut-online:maxPlayers', values.maxPlayers);
    window.localStorage.setItem('yut-online:playMode', values.playMode);
    window.localStorage.setItem('yut-online:itemMode', values.itemMode);
    window.localStorage.setItem('yut-online:pieceCount', values.pieceCount);

    const nativeRandom = Math.random;
    document.addEventListener('click', (event) => {
      const target = event.target;
      if (!(target instanceof Element) || !target.closest('[data-testid="roll-yut-button"]')) return;
      if (!document.body.textContent?.includes('ai-seq-room')) return;

      // This regression test must exercise an actual local move. Keep its Perfect roll on 개
      // instead of occasionally taking the valid 빽도-with-no-board-piece pass branch.
      Math.random = () => 0.3;
      queueMicrotask(() => {
        Math.random = nativeRandom;
      });
    }, true);
  }, { nickname: normalizedNickname, maxPlayers, playMode, itemMode, pieceCount });
}

export async function createRoomFromLobby(page, roomTitle) {
  await expectAppShell(page);
  await page.getByRole('button', { name: '방 만들기', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '방 만들기' })).toBeVisible();
  await page.getByTestId('room-title-input').fill(roomTitle);
  await page.getByTestId('create-room-button').click();
  await expect(page.getByTestId('waiting-room')).toBeVisible({ timeout: 25_000 });
}

export async function joinRoomFromLobby(page, roomTitle) {
  await expectAppShell(page);
  await waitForBlockingOverlayToDisappear(page);
  await page.getByRole('button', { name: '방 참가', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '방 참가' })).toBeVisible();
  const roomListLoading = page.getByTestId('room-list-loading');
  await expect(roomListLoading).toBeVisible();
  await expect(page.locator('.lobby-room-card')).toHaveCount(0);
  await expect(roomListLoading).toBeHidden({ timeout: 25_000 });
  const roomCard = page.locator('.lobby-room-card').filter({ hasText: roomTitle }).first();
  await expect(roomCard).toBeVisible({ timeout: 25_000 });
  const joinButton = roomCard.locator('.lobby-room-action');
  await expect(joinButton).toBeEnabled({ timeout: 10_000 });
  await joinButton.click();
  await expect(page.getByTestId('waiting-room').or(page.getByTestId('game-screen'))).toBeVisible({ timeout: 25_000 });
}

export async function markGuestReady(page) {
  const readyButton = page.getByRole('button', { name: '준비 완료' });
  if (await readyButton.isVisible().catch(() => false)) await readyButton.click();
}
