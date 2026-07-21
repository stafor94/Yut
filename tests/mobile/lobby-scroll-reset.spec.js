import { test, expect } from '@playwright/test';
import { collectScreenState, expectAppShell, primeLobbyStorage, runQaStep } from '../helpers/ui.js';
import { makeQaName, normalizeQaNickname } from '../helpers/env.js';
import { deleteRoomForQa, findRoomIdByTitle, rememberRoomIdFromPage } from '../helpers/rooms.js';

async function expectLobbyViewportUnlocked(page) {
  const viewportState = await page.evaluate(() => {
    const html = document.documentElement;
    const body = document.body;
    const root = document.getElementById('root');
    const shell = document.querySelector('[data-testid="app-shell"]');
    if (!(root instanceof HTMLElement) || !(shell instanceof HTMLElement)) return null;
    const shellRect = shell.getBoundingClientRect();
    const bottomTarget = document.elementFromPoint(Math.floor(window.innerWidth / 2), Math.max(0, window.innerHeight - 2));
    return {
      htmlLocked: html.classList.contains('lobby-viewport-lock'),
      bodyLocked: body.classList.contains('lobby-viewport-lock'),
      rootLocked: root.classList.contains('lobby-viewport-lock'),
      htmlOverflowY: window.getComputedStyle(html).overflowY,
      bodyOverflowY: window.getComputedStyle(body).overflowY,
      rootOverflowY: window.getComputedStyle(root).overflowY,
      shellOverflowY: window.getComputedStyle(shell).overflowY,
      shellHeight: shellRect.height,
      viewportHeight: window.innerHeight,
      bottomViewportIsInsideShell: Boolean(bottomTarget?.closest('[data-testid="app-shell"]')),
    };
  });

  expect(viewportState, '로비 뷰포트 잠금 해제 상태를 읽을 수 있어야 합니다.').not.toBeNull();
  expect(viewportState.htmlLocked).toBe(false);
  expect(viewportState.bodyLocked).toBe(false);
  expect(viewportState.rootLocked).toBe(false);
  expect(viewportState.htmlOverflowY).not.toBe('hidden');
  expect(viewportState.bodyOverflowY).not.toBe('hidden');
  expect(viewportState.rootOverflowY).not.toBe('hidden');
  expect(viewportState.shellOverflowY).not.toBe('hidden');
  expect(viewportState.shellHeight).toBeGreaterThanOrEqual(viewportState.viewportHeight - 1);
  expect(viewportState.bottomViewportIsInsideShell, '로비 하단 뷰포트가 앱 셸 밖의 빈 영역을 보여서는 안 됩니다.').toBe(true);
}

async function createRoom(page, roomTitle) {
  await expectAppShell(page);
  await page.getByRole('button', { name: '방 만들기', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '방 만들기' })).toBeVisible();
  await page.getByTestId('room-title-input').fill(roomTitle);
  await page.getByTestId('create-room-button').click();
  await expect(page.getByTestId('waiting-room')).toBeVisible({ timeout: 20_000 });
  return await rememberRoomIdFromPage(page) ?? await findRoomIdByTitle(roomTitle);
}

async function forceDocumentScroll(page, screenTestId) {
  await page.getByTestId(screenTestId).evaluate((screen) => {
    const spacer = document.createElement('div');
    spacer.dataset.testid = 'scroll-reset-spacer';
    spacer.style.height = '1200px';
    spacer.style.pointerEvents = 'none';
    screen.append(spacer);
    window.scrollTo(0, document.documentElement.scrollHeight);
  });

  await expect.poll(() => page.evaluate(() => window.scrollY), {
    timeout: 5_000,
    message: '로비 복귀 전 재현용 문서 스크롤이 발생해야 합니다.',
  }).toBeGreaterThan(0);
}

test.describe('mobile lobby scroll reset QA', () => {
  test('대기실에서 로비로 나오면 문서 스크롤을 제거하되 뷰포트를 잠그지 않는다', async ({ page, context }, testInfo) => {
    const nickname = normalizeQaNickname(makeQaName(testInfo, 'scroll-reset-host'));
    const roomTitle = makeQaName(testInfo, 'scroll-reset-room');
    let roomId;

    await primeLobbyStorage(context, {
      nickname,
      maxPlayers: '4',
      playMode: 'individual',
      itemMode: 'false',
      pieceCount: '4',
    });

    await runQaStep(testInfo, '대기실에서 로비 복귀 시 모바일 문서 스크롤 제거와 뷰포트 잠금 해제 확인', async () => {
      try {
        roomId = await createRoom(page, roomTitle);
        await forceDocumentScroll(page, 'waiting-room');

        await page.getByRole('button', { name: '방 나가기' }).click();
        await expect(page.getByTestId('lobby-screen')).toBeVisible({ timeout: 10_000 });
        await expect.poll(() => page.evaluate(() => window.scrollY), {
          timeout: 5_000,
          message: '로비 전환 후 문서 스크롤은 상단으로 초기화되어야 합니다.',
        }).toBe(0);
        await expectLobbyViewportUnlocked(page);
      } finally {
        if (roomId) await deleteRoomForQa(roomId);
      }
    });
  });

  test('인게임에서 종료해 로비로 나오면 문서 스크롤을 제거하되 뷰포트를 잠그지 않는다', async ({ page, context }, testInfo) => {
    test.slow();
    const nickname = normalizeQaNickname(makeQaName(testInfo, 'scroll-game-host'));
    const roomTitle = makeQaName(testInfo, 'scroll-game-room');
    let roomId;

    await primeLobbyStorage(context, {
      nickname,
      maxPlayers: '2',
      playMode: 'individual',
      itemMode: 'false',
      pieceCount: '4',
    });

    await runQaStep(testInfo, '인게임 종료 후 로비 복귀 시 모바일 문서 스크롤 제거와 뷰포트 잠금 해제 확인', async () => {
      try {
        roomId = await createRoom(page, roomTitle);
        await page.getByTestId('add-ai-P2').click();
        await expect.poll(async () => {
          const state = await collectScreenState(page);
          return {
            pendingAiSeatCount: Number(state.yutDebug?.pendingAiSeatCount ?? 0),
            allReady: Boolean(state.yutDebug?.allReady),
            startDisabled: Boolean(state.startButton.disabled),
          };
        }, {
          timeout: 25_000,
          message: 'AI 추가 동기화가 완료되어 시작 버튼이 활성화되어야 합니다.',
        }).toEqual({
          pendingAiSeatCount: 0,
          allReady: true,
          startDisabled: false,
        });
        await page.getByTestId('start-game-button').click();
        await expect(page.getByTestId('game-screen')).toBeVisible({ timeout: 25_000 });
        await forceDocumentScroll(page, 'game-screen');

        await page.getByTestId('game-end-button').click();
        const dialog = page.getByRole('dialog', { name: '게임 종료 확인' });
        await expect(dialog).toBeVisible();
        await dialog.getByRole('button', { name: '게임 종료', exact: true }).click();
        await expect(page.getByTestId('lobby-screen')).toBeVisible({ timeout: 15_000 });
        await expect.poll(() => page.evaluate(() => window.scrollY), {
          timeout: 5_000,
          message: '인게임 종료 후 로비 문서 스크롤은 상단으로 초기화되어야 합니다.',
        }).toBe(0);
        await expectLobbyViewportUnlocked(page);
      } finally {
        if (roomId) await deleteRoomForQa(roomId);
      }
    });
  });
});
