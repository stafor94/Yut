import { test, expect } from '@playwright/test';
import { hasFirebaseConfig, makeQaName, normalizeQaNickname } from '../helpers/env.js';
import { collectScreenState, createRoomFromLobby, expectAppShell, joinRoomFromLobby, primeLobbyStorage, runQaStep } from '../helpers/ui.js';
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

  test('비방장에게는 AI 난이도 배지만 보이고 선택 버튼은 보이지 않는다', async ({ browser }, testInfo) => {
    expect(await hasFirebaseConfig(), 'Firebase 설정이 없어 온라인 QA를 실행할 수 없습니다.').toBe(true);
    const hostContext = await browser.newContext();
    const guestContext = await browser.newContext();
    const hostName = normalizeQaNickname(makeQaName(testInfo, 'ai-visibility-host'));
    const guestName = normalizeQaNickname(makeQaName(testInfo, 'ai-visibility-guest'));
    const roomTitle = makeQaName(testInfo, 'ai-visibility-room');
    await primeLobbyStorage(hostContext, { nickname: hostName, maxPlayers: '3', playMode: 'individual', itemMode: 'false', pieceCount: '4' });
    await primeLobbyStorage(guestContext, { nickname: guestName, maxPlayers: '3', playMode: 'individual', itemMode: 'false', pieceCount: '4' });
    const hostPage = await hostContext.newPage();
    const guestPage = await guestContext.newPage();

    try {
      await runQaStep(testInfo, '방장 AI 추가 후 비방장 난이도 UI 확인', async () => {
        await createRoomFromLobby(hostPage, roomTitle);
        roomId = await rememberRoomIdFromPage(hostPage) ?? await findRoomIdByTitle(roomTitle);
        expect(roomId, '생성된 QA 방 ID가 필요합니다.').toBeTruthy();
        await hostPage.getByTestId('add-ai-P2').click();
        const hostAiCard = hostPage.locator('.compact-ready-card').filter({ hasText: 'P2' }).first();
        await expect(hostAiCard.locator('.seat-role-badge')).toHaveText('어려움 AI');
        await expect(hostPage.getByTestId('ai-difficulty-P2-hard')).toBeVisible();

        await joinRoomFromLobby(guestPage, roomTitle);
        const guestAiCard = guestPage.locator('.compact-ready-card').filter({ hasText: 'P2' }).first();
        await expect(guestAiCard).toBeVisible();
        await expect(guestAiCard.locator('.seat-role-badge')).toHaveText('어려움 AI');
        await expect(guestAiCard.locator('.ai-difficulty-selector')).toHaveCount(0);
        await expect(guestPage.getByTestId('ai-difficulty-P2-easy')).toHaveCount(0);
        await expect(guestPage.getByTestId('ai-difficulty-P2-hard')).toHaveCount(0);
      });
    } finally {
      await guestContext.close();
      await hostContext.close();
    }
  });

  test('AI 난이도 배지와 확대된 방장 전용 선택 버튼이 authoritative 방 상태와 인게임 카드에 반영된다', async ({ page, context }, testInfo) => {
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

      await expect(aiBadge).toHaveText('어려움 AI');
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
      expect(layout.easy.width, '난이도 버튼 폭은 기존보다 커야 합니다.').toBeGreaterThanOrEqual(48);
      expect(layout.easy.height, '난이도 버튼 높이는 누르기 쉬운 크기여야 합니다.').toBeGreaterThanOrEqual(26);
      expect(layout.hard.width).toBeGreaterThanOrEqual(48);
      expect(layout.hard.height).toBeGreaterThanOrEqual(26);
      expect(layout.remove.width, 'AI 제거 버튼은 기존보다 작은 폭이어야 합니다.').toBeLessThanOrEqual(70);
      expect(layout.remove.height, 'AI 제거 버튼은 compact 높이를 유지해야 합니다.').toBeLessThanOrEqual(30);
      expect(layout.ready.y - (layout.remove.y + layout.remove.height), 'AI 제거와 준비 사이에 세로 간격이 필요합니다.').toBeGreaterThanOrEqual(4);

      await easyButton.click();
      await expect(easyButton).toHaveAttribute('aria-pressed', 'true');
      await expect(aiBadge).toHaveText('쉬움 AI');
      await expect.poll(async () => {
        const players = await getRoomPlayersForQa(roomId);
        return players.find((player) => player.isAI)?.aiDifficulty ?? null;
      }, { timeout: 10_000 }).toBe('easy');

      await expect(page.getByTestId('start-game-button')).toBeEnabled({ timeout: 15_000 });
      await page.getByTestId('start-game-button').click();
      await expect(page.getByTestId('game-screen')).toBeVisible({ timeout: 25_000 });
      const inGameAiCard = page.locator('.game-player-card.ai').first();
      await expect(inGameAiCard).toBeVisible();
      await expect(inGameAiCard.locator('.game-player-status')).toHaveText('쉬움 AI');
    });
  });
});
