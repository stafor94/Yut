import { test, expect } from '@playwright/test';
import { createRoomFromLobby, primeLobbyStorage, runQaStep } from '../helpers/ui.js';
import { makeQaName, normalizeQaNickname } from '../helpers/env.js';
import { deleteRoomForQa, findRoomIdByTitle, rememberRoomIdFromPage } from '../helpers/rooms.js';

test.describe('turn-order final nickname alignment QA', () => {
  let roomId = '';

  test.afterEach(async () => {
    if (roomId) await deleteRoomForQa(roomId).catch(() => undefined);
    roomId = '';
  });

  test('내 배지 유무와 관계없이 최종 순서 닉네임 중심은 카드 중심과 일치한다', async ({ page, context }, testInfo) => {
    testInfo.setTimeout(120_000);
    const nickname = normalizeQaNickname(makeQaName(testInfo, 'final-center-host'));
    const roomTitle = makeQaName(testInfo, 'final-center-room');
    await primeLobbyStorage(context, {
      nickname,
      maxPlayers: '2',
      playMode: 'individual',
      itemMode: 'false',
      pieceCount: '4',
    });
    await context.addInitScript(() => {
      window.__YUT_QA_TURN_ORDER_RESULT_QUEUE__ = ['모'];
      window.__YUT_QA_AI_TURN_ORDER_RESULT_QUEUE__ = ['도'];
    });

    await runQaStep(testInfo, '최종 순서 카드의 좌우 고정 영역과 닉네임 중심 좌표 확인', async () => {
      await createRoomFromLobby(page, roomTitle);
      roomId = await rememberRoomIdFromPage(page) ?? await findRoomIdByTitle(roomTitle);
      await page.getByTestId('add-ai-P2').click();
      await expect(page.getByTestId('start-game-button')).toBeEnabled({ timeout: 15_000 });
      await page.getByTestId('start-game-button').click();
      await expect(page.getByTestId('game-screen')).toBeVisible({ timeout: 25_000 });
      await expect(page.getByTestId('turn-order-roll-button')).toBeVisible({ timeout: 15_000 });
      await page.getByTestId('turn-order-roll-button').click();

      const finalOrder = page.getByTestId('turn-order-final-order');
      await expect(finalOrder).toBeVisible({ timeout: 20_000 });
      const layout = await finalOrder.evaluate((element) => {
        const toBox = (target) => {
          const rect = target.getBoundingClientRect();
          return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
        };
        return {
          documentScrollWidth: document.documentElement.scrollWidth,
          viewportWidth: window.innerWidth,
          entries: Array.from(element.querySelectorAll('.turn-order-final-entry')).map((entry) => {
            const name = entry.querySelector(':scope > span');
            const rank = entry.querySelector(':scope > strong');
            const badge = entry.querySelector(':scope > em');
            if (!(name instanceof HTMLElement) || !(rank instanceof HTMLElement)) {
              throw new Error('최종 순서 카드의 순위 또는 닉네임을 찾지 못했습니다.');
            }
            const entryBox = toBox(entry);
            const nameBox = toBox(name);
            const rankBox = toBox(rank);
            const badgeBox = badge instanceof HTMLElement ? toBox(badge) : null;
            return {
              entryBox,
              nameBox,
              rankBox,
              badgeBox,
              gridTemplateColumns: getComputedStyle(entry).gridTemplateColumns,
              nameOverflow: getComputedStyle(name).overflow,
              nameTextOverflow: getComputedStyle(name).textOverflow,
              nameWhiteSpace: getComputedStyle(name).whiteSpace,
            };
          }),
        };
      });

      expect(layout.entries).toHaveLength(2);
      expect(layout.entries.filter((entry) => entry.badgeBox)).toHaveLength(1);
      expect(layout.entries.filter((entry) => !entry.badgeBox)).toHaveLength(1);
      expect(layout.documentScrollWidth).toBeLessThanOrEqual(layout.viewportWidth + 1);

      for (const entry of layout.entries) {
        const entryCenter = entry.entryBox.x + entry.entryBox.width / 2;
        const nameCenter = entry.nameBox.x + entry.nameBox.width / 2;
        expect(Math.abs(nameCenter - entryCenter), '닉네임 영역은 최종 순서 카드의 실제 중앙에 있어야 합니다.').toBeLessThanOrEqual(1);
        expect(entry.gridTemplateColumns.split(' ').filter(Boolean)).toHaveLength(3);
        expect(Math.abs(entry.rankBox.width - 28)).toBeLessThanOrEqual(1);
        if (entry.badgeBox) expect(Math.abs(entry.badgeBox.width - 32)).toBeLessThanOrEqual(1);
        expect(entry.nameOverflow).toBe('hidden');
        expect(entry.nameTextOverflow).toBe('ellipsis');
        expect(entry.nameWhiteSpace).toBe('nowrap');
      }
    });
  });
});
