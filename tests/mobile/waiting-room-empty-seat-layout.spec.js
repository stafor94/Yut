import { test, expect } from '@playwright/test';
import { createRoomFromLobby, primeLobbyStorage, runQaStep } from '../helpers/ui.js';
import { makeQaName } from '../helpers/env.js';
import { deleteRoomForQa, findRoomIdByTitle, rememberRoomIdFromPage } from '../helpers/rooms.js';

async function readEmptySeatLayout(card) {
  return card.evaluate((element) => {
    const row = element.querySelector('.seat-row');
    const badge = element.querySelector('.empty-seat-badge');
    const action = element.querySelector('.ai-add-button');
    const list = element.parentElement;
    if (!(row instanceof HTMLElement) || !(badge instanceof HTMLElement) || !(action instanceof HTMLElement) || !(list instanceof HTMLElement)) return null;

    const box = (target) => {
      const rect = target.getBoundingClientRect();
      return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
    };
    const card = box(element);
    const rowBox = box(row);
    const badgeBox = box(badge);
    const actionBox = box(action);
    const cardStyle = getComputedStyle(element);
    const listStyle = getComputedStyle(list);

    return {
      card,
      row: rowBox,
      badge: badgeBox,
      action: actionBox,
      bottomInset: card.bottom - Math.max(badgeBox.bottom, actionBox.bottom),
      boxShadow: cardStyle.boxShadow,
      overflow: cardStyle.overflow,
      listOverflow: listStyle.overflow,
    };
  });
}

test.describe('waiting-room empty seat card layout QA', () => {
  test('P3·P4 빈자리 카드 하단이 잘리지 않고 음영과 내부 여백을 유지한다', async ({ page, context }, testInfo) => {
    const roomTitle = makeQaName(testInfo, 'empty-seat-bottom');
    let roomId;

    await primeLobbyStorage(context, {
      nickname: '빈자리검증',
      maxPlayers: '4',
      playMode: 'individual',
      itemMode: 'false',
      pieceCount: '4',
    });

    await runQaStep(testInfo, 'P3·P4 빈자리 카드 하단 geometry 확인', async () => {
      try {
        await createRoomFromLobby(page, roomTitle);
        roomId = await rememberRoomIdFromPage(page) ?? await findRoomIdByTitle(roomTitle);

        const p3Card = page.locator('.compact-ready-card.empty').filter({ hasText: 'P3' }).first();
        const p4Card = page.locator('.compact-ready-card.empty').filter({ hasText: 'P4' }).first();
        await expect(p3Card).toBeVisible();
        await expect(p4Card).toBeVisible();

        const p3Layout = await readEmptySeatLayout(p3Card);
        const p4Layout = await readEmptySeatLayout(p4Card);
        for (const [label, layout] of [['P3', p3Layout], ['P4', p4Layout]]) {
          expect(layout, `${label} 빈자리 카드 geometry를 읽을 수 있어야 합니다.`).not.toBeNull();
          expect(layout.overflow, `${label} 카드 음영이 카드 경계에서 잘리면 안 됩니다.`).toBe('visible');
          expect(layout.listOverflow, `${label} 카드 음영이 목록 경계에서 잘리면 안 됩니다.`).toBe('visible');
          expect(layout.boxShadow, `${label} 빈자리 카드에도 하단 음영이 있어야 합니다.`).not.toBe('none');
          expect(layout.bottomInset, `${label} 빈자리 카드 내용과 하단 경계 사이에 여백이 있어야 합니다.`).toBeGreaterThanOrEqual(4);
          expect(layout.row.bottom, `${label} 자리 행이 카드 하단을 넘으면 안 됩니다.`).toBeLessThanOrEqual(layout.card.bottom + 1);
        }

        expect(p4Layout.card.top - p3Layout.card.bottom, 'P3와 P4 카드 사이에 음영이 보일 간격이 있어야 합니다.').toBeGreaterThanOrEqual(6);
      } finally {
        if (roomId) await deleteRoomForQa(roomId);
      }
    });
  });
});
