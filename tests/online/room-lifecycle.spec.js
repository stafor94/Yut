import { test, expect } from '@playwright/test';
import { hasFirebaseConfig, makeQaName, normalizeQaNickname } from '../helpers/env.js';
import { collectScreenState, expectAppShell, primeLobbyStorage, runQaStep } from '../helpers/ui.js';
import { deleteRoomForQa, findRoomIdByTitle, getRoomPlayersForQa, rememberRoomIdFromPage } from '../helpers/rooms.js';

test.describe('online room QA', () => {
  let roomId;

  test.afterEach(async () => {
    await deleteRoomForQa(roomId).catch(() => undefined);
  });

  test('방 생성 후 대기실에 진입한다', async ({ page, context }, testInfo) => {
    expect(await hasFirebaseConfig(), 'Firebase 설정이 없어 온라인 QA를 실행할 수 없습니다.').toBe(true);
    const nickname = normalizeQaNickname(makeQaName(testInfo, 'online-host'));
    const roomTitle = makeQaName(testInfo, 'online-room');
    await primeLobbyStorage(context, { nickname, maxPlayers: '2', playMode: 'individual', itemMode: 'false', pieceCount: '4' });

    await runQaStep(testInfo, '온라인 방 생성 및 대기실 확인', async () => {
      await expectAppShell(page);
      await page.getByTestId('room-title-input').fill(roomTitle);
      await page.getByTestId('create-room-button').click();
      await expect(page.getByTestId('waiting-room'), `대기실 상태: ${JSON.stringify(await collectScreenState(page), null, 2)}`).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId('waiting-room')).toContainText(nickname);
      roomId = await rememberRoomIdFromPage(page) ?? await findRoomIdByTitle(roomTitle);
    });
  });

  test('AI 난이도 선택과 축소된 제거 버튼이 authoritative 방 상태와 일치한다', async ({ page, context }, testInfo) => {
    expect(await hasFirebaseConfig(), 'Firebase 설정이 없어 온라인 QA를 실행할 수 없습니다.').toBe(true);
    const nickname = normalizeQaNickname(makeQaName(testInfo, 'ai-level-host'));
    const roomTitle = makeQaName(testInfo, 'ai-level-room');
    await primeLobbyStorage(context, { nickname, maxPlayers: '2', playMode: 'individual', itemMode: 'false', pieceCount: '4' });

    await runQaStep(testInfo, '대기실 AI 난이도 UI와 저장 상태 확인', async () => {
      await expectAppShell(page);
      await page.getByTestId('room-title-input').fill(roomTitle);
      await page.getByTestId('create-room-button').click();
      await expect(page.getByTestId('waiting-room')).toBeVisible({ timeout: 15_000 });
      roomId = await rememberRoomIdFromPage(page) ?? await findRoomIdByTitle(roomTitle);
      expect(roomId, '생성된 QA 방 ID가 필요합니다.').toBeTruthy();

      await page.getByTestId('add-ai-P2').click();
      const card = page.locator('.compact-ready-card').filter({ hasText: 'P2' }).first();
      const easyButton = page.getByTestId('ai-difficulty-P2-easy');
      const hardButton = page.getByTestId('ai-difficulty-P2-hard');
      const removeButton = card.locator('.ai-remove-button');
      const readyLabel = card.locator('.seat-ready-label');
      const aiBadge = card.locator('.seat-role-badge');

      await expect(card).toContainText('AI');
      await expect(easyButton).toBeVisible();
      await expect(hardButton).toBeVisible();
      await expect(hardButton).toHaveAttribute('aria-pressed', 'true');
      await expect(removeButton).toBeVisible();
      await expect(readyLabel).toBeVisible();

      const layout = await card.evaluate((element) => {
        const box = (selector) => {
          const target = element.querySelector(selector);
          if (!target) return null;
          const rect = target.getBoundingClientRect();
          return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
        };
        return {
          aiBadge: box('.seat-role-badge'),
          easy: box('[data-testid="ai-difficulty-P2-easy"]'),
          hard: box('[data-testid="ai-difficulty-P2-hard"]'),
          remove: box('.ai-remove-button'),
          ready: box('.seat-ready-label'),
        };
      });

      expect(layout.aiBadge).not.toBeNull();
      expect(layout.easy).not.toBeNull();
      expect(layout.hard).not.toBeNull();
      expect(layout.remove).not.toBeNull();
      expect(layout.ready).not.toBeNull();
      expect(layout.easy.x, '난이도 선택은 AI 배지 오른쪽에 있어야 합니다.').toBeGreaterThanOrEqual(layout.aiBadge.x + layout.aiBadge.width);
      expect(layout.hard.y, '쉬움/어려움 버튼은 위아래로 배치되어야 합니다.').toBeGreaterThan(layout.easy.y + layout.easy.height);
      expect(layout.remove.width, 'AI 제거 버튼은 기존보다 작은 폭이어야 합니다.').toBeLessThanOrEqual(70);
      expect(layout.remove.height, 'AI 제거 버튼은 compact 높이를 유지해야 합니다.').toBeLessThanOrEqual(30);
      expect(layout.ready.y - (layout.remove.y + layout.remove.height), 'AI 제거와 준비 사이에 세로 간격이 필요합니다.').toBeGreaterThanOrEqual(4);

      await easyButton.click();
      await expect(easyButton).toHaveAttribute('aria-pressed', 'true');
      await expect.poll(async () => {
        const players = await getRoomPlayersForQa(roomId);
        return players.find((player) => player.isAI)?.aiDifficulty ?? null;
      }, { timeout: 10_000 }).toBe('easy');
    });
  });
});
