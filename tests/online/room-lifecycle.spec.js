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
        await expect(hostAiCard.locator('.seat-ready-label')).toHaveCount(0);

        await joinRoomFromLobby(guestPage, roomTitle);
        const guestAiCard = guestPage.locator('.compact-ready-card').filter({ hasText: 'P2' }).first();
        await expect(guestAiCard).toBeVisible();
        await expect(guestAiCard.locator('.seat-role-badge')).toHaveText('어려움 AI');
        await expect(guestAiCard.locator('.seat-ready-label')).toHaveCount(0);
        await expect(guestAiCard.locator('.ai-difficulty-selector')).toHaveCount(0);
        await expect(guestPage.getByTestId('ai-difficulty-P2-easy')).toHaveCount(0);
        await expect(guestPage.getByTestId('ai-difficulty-P2-hard')).toHaveCount(0);
      });
    } finally {
      await guestContext.close();
      await hostContext.close();
    }
  });

  test('AI 배지와 방장 전용 액션이 요청한 대기실 배치와 인게임 난이도에 반영된다', async ({ page, context }, testInfo) => {
    expect(await hasFirebaseConfig(), 'Firebase 설정이 없어 온라인 QA를 실행할 수 없습니다.').toBe(true);
    const nickname = normalizeQaNickname(makeQaName(testInfo, 'ai-level-host'));
    const roomTitle = makeQaName(testInfo, 'ai-level-room');
    await primeLobbyStorage(context, { nickname, maxPlayers: '2', playMode: 'individual', itemMode: 'false', pieceCount: '4' });

    await runQaStep(testInfo, '대기실 AI 배지와 액션 배치 및 저장 상태 확인', async () => {
      await expectAppShell(page);
      await page.getByTestId('room-title-input').fill(roomTitle);
      await page.getByTestId('create-room-button').click();
      await expect(page.getByTestId('waiting-room')).toBeVisible({ timeout: 15_000 });
      roomId = await rememberRoomIdFromPage(page) ?? await findRoomIdByTitle(roomTitle);
      expect(roomId, '생성된 QA 방 ID가 필요합니다.').toBeTruthy();

      const emptyCard = page.locator('.compact-ready-card').filter({ hasText: 'P2' }).first();
      const addButton = page.getByTestId('add-ai-P2');
      await expect(addButton).toBeVisible();
      const addLayout = await emptyCard.evaluate((element) => {
        const button = element.querySelector('[data-testid="add-ai-P2"]');
        if (!(button instanceof HTMLElement)) throw new Error('AI 추가 버튼을 찾지 못했습니다.');
        const cardRect = element.getBoundingClientRect();
        const buttonRect = button.getBoundingClientRect();
        return {
          card: { x: cardRect.x, y: cardRect.y, width: cardRect.width, height: cardRect.height },
          add: { x: buttonRect.x, y: buttonRect.y, width: buttonRect.width, height: buttonRect.height },
        };
      });

      await addButton.click();
      const card = page.locator('.compact-ready-card').filter({ hasText: 'P2' }).first();
      const easyButton = page.getByTestId('ai-difficulty-P2-easy');
      const hardButton = page.getByTestId('ai-difficulty-P2-hard');
      const removeButton = card.locator('.ai-remove-button');
      const aiBadge = card.locator('.seat-role-badge');

      await expect(aiBadge).toHaveText('어려움 AI');
      await expect(easyButton).toBeVisible();
      await expect(hardButton).toBeVisible();
      await expect(hardButton).toHaveAttribute('aria-pressed', 'true');
      await expect(removeButton).toBeVisible();
      await expect(card.locator('.seat-ready-label')).toHaveCount(0);

      const layout = await card.evaluate((element) => {
        const box = (selector) => {
          const target = element.querySelector(selector);
          if (!target) return null;
          const rect = target.getBoundingClientRect();
          return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
        };
        const cardRect = element.getBoundingClientRect();
        return {
          card: { x: cardRect.x, y: cardRect.y, width: cardRect.width, height: cardRect.height },
          aiBadge: box('.seat-role-badge'),
          nickname: box('.ai-seat-copy > strong'),
          easy: box('[data-testid="ai-difficulty-P2-easy"]'),
          hard: box('[data-testid="ai-difficulty-P2-hard"]'),
          remove: box('.ai-remove-button'),
        };
      });

      for (const key of ['aiBadge', 'nickname', 'easy', 'hard', 'remove']) expect(layout[key], `${key} bounding box`).not.toBeNull();
      expect(layout.aiBadge.y + layout.aiBadge.height, 'AI 난이도 배지는 닉네임 위쪽에 있어야 합니다.').toBeLessThanOrEqual(layout.nickname.y + 1);
      expect(layout.hard.y, '쉬움/어려움 버튼은 위아래로 배치되어야 합니다.').toBeGreaterThan(layout.easy.y + layout.easy.height);
      expect(Math.abs(layout.remove.x - (layout.easy.x + layout.easy.width) - 12), '난이도 선택과 AI 제거 버튼 사이 간격은 12px이어야 합니다.').toBeLessThanOrEqual(1);
      expect(layout.easy.width, '난이도 버튼 폭은 누르기 쉬운 크기여야 합니다.').toBeGreaterThanOrEqual(48);
      expect(layout.easy.height, '난이도 버튼 높이는 누르기 쉬운 크기여야 합니다.').toBeGreaterThanOrEqual(26);
      expect(layout.hard.width).toBeGreaterThanOrEqual(48);
      expect(layout.hard.height).toBeGreaterThanOrEqual(26);
      expect(Math.abs(layout.remove.width - addLayout.add.width), 'AI 제거 버튼 폭은 AI 추가 버튼과 같아야 합니다.').toBeLessThanOrEqual(1);
      expect(Math.abs(layout.remove.height - addLayout.add.height), 'AI 제거 버튼 높이는 AI 추가 버튼과 같아야 합니다.').toBeLessThanOrEqual(1);
      expect(Math.abs(layout.remove.x - addLayout.add.x), 'AI 제거 버튼의 가로 위치는 AI 추가 버튼과 같아야 합니다.').toBeLessThanOrEqual(1);
      expect(Math.abs(layout.remove.y - addLayout.add.y), 'AI 제거 버튼의 세로 위치는 AI 추가 버튼과 같아야 합니다.').toBeLessThanOrEqual(1);
      expect(Math.abs(layout.card.height - addLayout.card.height), 'AI 추가 전후 카드 높이는 같아야 합니다.').toBeLessThanOrEqual(1);

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
