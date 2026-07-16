import { test, expect } from '@playwright/test';
import { expectAppShell, joinRoomFromLobby, primeLobbyStorage, runQaStep, waitForBlockingOverlayToDisappear } from '../helpers/ui.js';
import { makeQaName, normalizeQaNickname } from '../helpers/env.js';
import { createLobbyRoomFixtureForQa, deleteRoomForQa, findRoomIdByTitle, rememberRoomIdFromPage } from '../helpers/rooms.js';

function boxesOverlap(a, b) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

async function readAiCardLayout(card) {
  return card.evaluate((element) => {
    const cardRect = element.getBoundingClientRect();
    const box = (selector) => {
      const target = element.querySelector(selector);
      if (!target) return null;
      const rect = target.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    };
    const nickname = element.querySelector('.ai-seat-copy > strong');
    const actions = element.querySelector('.ai-seat-actions');
    const nicknameStyle = nickname ? getComputedStyle(nickname) : null;
    return {
      viewportWidth: window.innerWidth,
      card: { x: cardRect.x, y: cardRect.y, width: cardRect.width, height: cardRect.height },
      seatLabel: box('.seat-identity > b'),
      aiBadge: box('.ai-seat-copy > .seat-role-badge'),
      nickname: box('.ai-seat-copy > strong'),
      actions: box('.ai-seat-actions'),
      easy: box('[data-testid$="-easy"]'),
      hard: box('[data-testid$="-hard"]'),
      remove: box('.ai-remove-button'),
      actionDisplay: actions ? getComputedStyle(actions).display : '',
      nicknameClientWidth: nickname instanceof HTMLElement ? nickname.clientWidth : 0,
      nicknameScrollWidth: nickname instanceof HTMLElement ? nickname.scrollWidth : 0,
      nicknameStyles: nicknameStyle ? {
        overflow: nicknameStyle.overflow,
        textOverflow: nicknameStyle.textOverflow,
        whiteSpace: nicknameStyle.whiteSpace,
      } : null,
    };
  });
}

test.describe('mobile layout QA', () => {
  test('모바일/태블릿 뷰포트에서 로비 핵심 탭 대상이 보인다', async ({ page }, testInfo) => {
    await runQaStep(testInfo, '모바일 로비 핵심 UI 확인', async () => {
      await expectAppShell(page);
      await expect(page.getByTestId('room-title-input')).toBeVisible();
      await expect(page.getByTestId('create-room-button')).toBeVisible();
      await expect(page.getByTestId('create-room-button')).toBeEnabled();
    });
  });

  test('닉네임 팝업이 목재 프레임 안에서 모바일 화면을 벗어나지 않는다', async ({ page, context }, testInfo) => {
    await primeLobbyStorage(context, { nickname: '모바일QA' });
    await runQaStep(testInfo, '모바일 공통 팝업 스타일 확인', async () => {
      await expectAppShell(page);
      await page.locator('.nickname-chip').click();

      const backdrop = page.locator('.nickname-dialog-backdrop');
      const modal = backdrop.locator('.nickname-modal');
      await expect(backdrop).toBeVisible();
      await expect(modal).toBeVisible();

      const layout = await modal.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return {
          rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          viewport: { width: window.innerWidth, height: window.innerHeight },
          borderWidth: Number.parseFloat(style.borderTopWidth),
          backgroundImage: style.backgroundImage,
          boxShadow: style.boxShadow,
        };
      });

      expect(layout.borderWidth, '공통 팝업은 두꺼운 목재 프레임을 사용해야 합니다.').toBeGreaterThanOrEqual(5);
      expect(layout.backgroundImage, '공통 팝업은 목재/한지 그라데이션 표면을 사용해야 합니다.').toContain('gradient');
      expect(layout.boxShadow, '공통 팝업은 입체 프레임 그림자를 사용해야 합니다.').not.toBe('none');
      expect(layout.rect.x, '팝업 왼쪽이 뷰포트 밖으로 나가면 안 됩니다.').toBeGreaterThanOrEqual(0);
      expect(layout.rect.y, '팝업 위쪽이 뷰포트 밖으로 나가면 안 됩니다.').toBeGreaterThanOrEqual(0);
      expect(layout.rect.x + layout.rect.width, '팝업 오른쪽이 뷰포트 밖으로 나가면 안 됩니다.').toBeLessThanOrEqual(layout.viewport.width);
      expect(layout.rect.y + layout.rect.height, '팝업 아래쪽이 뷰포트 밖으로 나가면 안 됩니다.').toBeLessThanOrEqual(layout.viewport.height);

      await page.getByRole('button', { name: '취소' }).click();
      await expect(backdrop).toBeHidden();
    });
  });

  test('모바일 AI 배지와 닉네임이 방장/일반 플레이어 화면에서 겹치지 않는다', async ({ page, context, browser }, testInfo) => {
    const nickname = normalizeQaNickname(makeQaName(testInfo, 'mobile-ai-host'));
    const guestNickname = normalizeQaNickname(makeQaName(testInfo, 'mobile-ai-guest'));
    const roomTitle = makeQaName(testInfo, 'mobile-ai-room');
    let roomId;
    let guestContext;
    await primeLobbyStorage(context, { nickname, maxPlayers: '3', playMode: 'individual', itemMode: 'false', pieceCount: '4' });

    await runQaStep(testInfo, '모바일 AI 배지와 액션 영역 배치 확인', async () => {
      try {
        await expectAppShell(page);
        await page.getByTestId('room-title-input').fill(roomTitle);
        await page.getByTestId('create-room-button').click();
        await expect(page.getByTestId('waiting-room')).toBeVisible({ timeout: 15_000 });
        roomId = await rememberRoomIdFromPage(page) ?? await findRoomIdByTitle(roomTitle);

        const emptyCard = page.locator('.compact-ready-card').filter({ hasText: 'P3' }).first();
        const addButton = page.getByTestId('add-ai-P3');
        await expect(addButton).toBeVisible();
        const addLayout = await emptyCard.evaluate((element) => {
          const button = element.querySelector('[data-testid="add-ai-P3"]');
          if (!(button instanceof HTMLElement)) throw new Error('AI 추가 버튼을 찾지 못했습니다.');
          const cardRect = element.getBoundingClientRect();
          const buttonRect = button.getBoundingClientRect();
          return {
            card: { x: cardRect.x, y: cardRect.y, width: cardRect.width, height: cardRect.height },
            add: { x: buttonRect.x, y: buttonRect.y, width: buttonRect.width, height: buttonRect.height },
          };
        });

        await addButton.click();
        const card = page.locator('.compact-ready-card').filter({ hasText: 'P3' }).first();
        const easyButton = page.getByTestId('ai-difficulty-P3-easy');
        const hardButton = page.getByTestId('ai-difficulty-P3-hard');
        await expect(card).toBeVisible();
        await expect(easyButton).toBeVisible();
        await expect(hardButton).toBeVisible();
        await expect(card.locator('.seat-ready-label')).toHaveCount(0);

        const layout = await readAiCardLayout(card);
        for (const key of ['seatLabel', 'aiBadge', 'nickname', 'easy', 'hard', 'remove']) expect(layout[key], `${key} bounding box`).not.toBeNull();
        const cardRight = layout.card.x + layout.card.width;
        for (const key of ['seatLabel', 'aiBadge', 'nickname', 'easy', 'hard', 'remove']) {
          const box = layout[key];
          expect(box.x, `${key} 왼쪽은 카드 안에 있어야 합니다.`).toBeGreaterThanOrEqual(layout.card.x);
          expect(box.x + box.width, `${key} 오른쪽은 카드 안에 있어야 합니다.`).toBeLessThanOrEqual(cardRight + 1);
        }
        expect(cardRight, 'AI 카드는 모바일 뷰포트를 벗어나면 안 됩니다.').toBeLessThanOrEqual(layout.viewportWidth + 1);
        expect(boxesOverlap(layout.aiBadge, layout.nickname), 'AI 난이도 배지와 닉네임이 겹치면 안 됩니다.').toBe(false);
        expect(Math.abs(layout.aiBadge.x - layout.nickname.x), 'AI 난이도 배지와 닉네임의 왼쪽 좌표가 같아야 합니다.').toBeLessThanOrEqual(1);
        expect(layout.nickname.x, 'AI 정보는 플레이어 번호 바로 오른쪽에서 시작해야 합니다.').toBeGreaterThanOrEqual(layout.seatLabel.x + layout.seatLabel.width);
        expect(layout.aiBadge.y + layout.aiBadge.height, 'AI 난이도 배지는 닉네임 위쪽에 있어야 합니다.').toBeLessThanOrEqual(layout.nickname.y);
        expect(layout.hard.y).toBeGreaterThan(layout.easy.y + layout.easy.height);
        expect(boxesOverlap(layout.easy, layout.remove), '난이도 선택과 AI 제거 버튼이 겹치면 안 됩니다.').toBe(false);
        expect(boxesOverlap(layout.hard, layout.remove), '난이도 선택과 AI 제거 버튼이 겹치면 안 됩니다.').toBe(false);
        expect(Math.abs(layout.remove.x - (layout.easy.x + layout.easy.width) - 12), '난이도 선택과 AI 제거 버튼 사이 간격은 12px이어야 합니다.').toBeLessThanOrEqual(1);
        expect(Math.abs(layout.remove.width - addLayout.add.width), 'AI 제거 버튼 폭은 AI 추가 버튼과 같아야 합니다.').toBeLessThanOrEqual(1);
        expect(Math.abs(layout.remove.height - addLayout.add.height), 'AI 제거 버튼 높이는 AI 추가 버튼과 같아야 합니다.').toBeLessThanOrEqual(1);
        expect(Math.abs(layout.remove.x - addLayout.add.x), 'AI 제거 버튼 가로 위치는 AI 추가 버튼과 같아야 합니다.').toBeLessThanOrEqual(1);
        expect(Math.abs(layout.remove.y - addLayout.add.y), 'AI 제거 버튼 세로 위치는 AI 추가 버튼과 같아야 합니다.').toBeLessThanOrEqual(1);
        expect(Math.abs(layout.card.height - addLayout.card.height), 'AI 추가 전후 카드 높이는 같아야 합니다.').toBeLessThanOrEqual(1);
        expect(layout.nicknameStyles).toEqual({ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });

        await card.locator('.ai-seat-copy > strong').evaluate((element) => {
          element.textContent = '아주아주긴인공지능플레이어닉네임말줄임검증';
        });
        const longNameLayout = await readAiCardLayout(card);
        expect(longNameLayout.nicknameScrollWidth, '긴 AI 닉네임은 실제 표시 폭보다 길어야 합니다.').toBeGreaterThan(longNameLayout.nicknameClientWidth);
        expect(longNameLayout.nickname.x + longNameLayout.nickname.width, '긴 AI 닉네임은 우측 액션 영역을 침범하면 안 됩니다.').toBeLessThanOrEqual(longNameLayout.actions.x);

        guestContext = await browser.newContext({
          baseURL: testInfo.project.use.baseURL,
          viewport: page.viewportSize() ?? { width: 390, height: 844 },
        });
        await primeLobbyStorage(guestContext, { nickname: guestNickname, maxPlayers: '3', playMode: 'individual', itemMode: 'false', pieceCount: '4' });
        const guestPage = await guestContext.newPage();
        await joinRoomFromLobby(guestPage, roomTitle);
        const guestCard = guestPage.locator('.compact-ready-card').filter({ hasText: 'P3' }).first();
        await expect(guestCard).toBeVisible();
        await expect(guestCard.locator('.ai-difficulty-selector')).toHaveCount(0);
        await expect(guestCard.locator('.ai-remove-button')).toHaveCount(0);

        const guestLayout = await readAiCardLayout(guestCard);
        for (const key of ['seatLabel', 'aiBadge', 'nickname']) expect(guestLayout[key], `guest ${key} bounding box`).not.toBeNull();
        expect(guestLayout.actionDisplay, '일반 플레이어 화면의 빈 AI 액션 열은 레이아웃을 차지하면 안 됩니다.').toBe('none');
        expect(boxesOverlap(guestLayout.aiBadge, guestLayout.nickname), '일반 플레이어 화면에서도 AI 배지와 닉네임이 겹치면 안 됩니다.').toBe(false);
        expect(Math.abs(guestLayout.aiBadge.x - guestLayout.nickname.x), '일반 플레이어 화면에서도 배지와 닉네임의 왼쪽 좌표가 같아야 합니다.').toBeLessThanOrEqual(1);
        expect(guestLayout.nickname.x, '일반 플레이어 화면에서도 AI 정보는 플레이어 번호 바로 오른쪽에서 시작해야 합니다.').toBeGreaterThanOrEqual(guestLayout.seatLabel.x + guestLayout.seatLabel.width);
        expect(guestLayout.aiBadge.y + guestLayout.aiBadge.height, '일반 플레이어 화면에서도 난이도 배지는 닉네임 위쪽에 있어야 합니다.').toBeLessThanOrEqual(guestLayout.nickname.y);
      } finally {
        await guestContext?.close();
        if (roomId) await deleteRoomForQa(roomId);
      }
    });
  });

  test('모바일 로비 방 카드의 좌우 영역이 겹치지 않는다', async ({ page, context }, testInfo) => {
    const hostNickname = normalizeQaNickname(makeQaName(testInfo, 'mobile-card-host'));
    const guestNickname = normalizeQaNickname(makeQaName(testInfo, 'mobile-card-guest'));
    const roomTitle = `${makeQaName(testInfo, 'mobile-card-room')}-긴-방-제목-겹침-검증`;
    let roomId;
    await primeLobbyStorage(context, { nickname: guestNickname, maxPlayers: '2', playMode: 'individual', itemMode: 'true', pieceCount: '5' });

    await runQaStep(testInfo, '모바일 로비 방 카드 boundingBox 겹침 확인', async () => {
      try {
        roomId = await createLobbyRoomFixtureForQa({
          title: roomTitle,
          hostNickname,
          maxPlayers: 2,
          playMode: 'individual',
          itemMode: true,
          stackedRollMode: false,
          pieceCount: 4,
        });

        await expectAppShell(page);
        await waitForBlockingOverlayToDisappear(page);
        const roomCard = page.locator('.lobby-room-card').filter({ hasText: roomTitle }).first();
        await expect(roomCard).toBeVisible({ timeout: 20_000 });

        try {
          await expect(async () => {
            const layout = await roomCard.evaluate((card) => {
              const main = card.querySelector('.lobby-room-main');
              const side = card.querySelector('.lobby-room-side');
              const title = card.querySelector('.lobby-room-main > b');
              const meta = card.querySelector('.lobby-room-meta');
              const status = card.querySelector('.lobby-room-status');
              const action = card.querySelector('.lobby-room-action');
              const content = card.querySelector('.lobby-room-content');
              const toBox = (element) => {
                if (!element) return null;
                const rect = element.getBoundingClientRect();
                if (rect.width <= 0 || rect.height <= 0) return null;
                return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
              };

              return {
                cardBox: toBox(card),
                mainBox: toBox(main),
                sideBox: toBox(side),
                titleBox: toBox(title),
                metaBox: toBox(meta),
                statusBox: toBox(status),
                actionBox: toBox(action),
                styles: {
                  cardPaddingLeft: Number.parseFloat(getComputedStyle(card).paddingLeft),
                  cardPaddingRight: Number.parseFloat(getComputedStyle(card).paddingRight),
                  cardBorderRightWidth: Number.parseFloat(getComputedStyle(card).borderRightWidth),
                  cardColumns: getComputedStyle(card).gridTemplateColumns,
                  contentDisplay: content ? getComputedStyle(content).display : '',
                  sideWidth: side ? getComputedStyle(side).width : '',
                  statusWidth: status ? getComputedStyle(status).width : '',
                  actionWidth: action ? getComputedStyle(action).width : '',
                },
              };
            });

            const { cardBox, mainBox, sideBox, titleBox, metaBox, statusBox, actionBox, styles } = layout;
            expect(cardBox, '카드 bounding box').not.toBeNull();
            expect(mainBox, '왼쪽 main column bounding box').not.toBeNull();
            expect(sideBox, '오른쪽 action column bounding box').not.toBeNull();
            expect(titleBox, '방 제목 bounding box').not.toBeNull();
            expect(metaBox, '옵션 배지 bounding box').not.toBeNull();
            expect(statusBox, '상태 배지 bounding box').not.toBeNull();
            expect(actionBox, '참여 버튼 bounding box').not.toBeNull();
            expect(styles.cardPaddingLeft, '카드 좌우 padding은 동일해야 합니다.').toBe(styles.cardPaddingRight);
            expect(styles.cardPaddingRight, '모바일 카드 오른쪽 padding은 20px이어야 합니다.').toBe(20);
            expect(styles.cardColumns, 'card grid는 오른쪽 76px action column을 가져야 합니다.').toContain('76px');
            expect(styles.contentDisplay, 'content wrapper는 card grid 배치를 위해 contents로 풀려야 합니다.').toBe('contents');
            expect(styles.sideWidth, 'side column 폭은 76px이어야 합니다.').toBe('76px');
            expect(styles.statusWidth, '대기중 배지는 side column 전체 폭을 사용해야 합니다.').toBe('76px');
            expect(styles.actionWidth, '참여 버튼은 side column 전체 폭을 사용해야 합니다.').toBe('76px');

            const cardContentRight = cardBox.x + cardBox.width - styles.cardBorderRightWidth - styles.cardPaddingRight;
            expect(Math.abs((sideBox.x + sideBox.width) - cardContentRight), 'side column은 카드 오른쪽 테두리와 padding 안쪽 끝에 붙어야 합니다.').toBeLessThanOrEqual(1);
            expect(Math.abs((statusBox.x + statusBox.width) - cardContentRight), '대기중 배지는 카드 오른쪽 테두리와 padding 안쪽 끝에 붙어야 합니다.').toBeLessThanOrEqual(1);
            expect(Math.abs((actionBox.x + actionBox.width) - cardContentRight), '참여 버튼은 카드 오른쪽 테두리와 padding 안쪽 끝에 붙어야 합니다.').toBeLessThanOrEqual(1);
            expect(mainBox.x + mainBox.width, 'main column은 side column과 겹치면 안 됩니다.').toBeLessThanOrEqual(sideBox.x);
            expect(boxesOverlap(titleBox, statusBox), '방 제목은 상태 배지와 겹치면 안 됩니다.').toBe(false);
            expect(boxesOverlap(titleBox, actionBox), '방 제목은 참여 버튼과 겹치면 안 됩니다.').toBe(false);
            expect(boxesOverlap(metaBox, statusBox), '옵션 배지는 상태 배지와 겹치면 안 됩니다.').toBe(false);
            expect(boxesOverlap(metaBox, actionBox), '옵션 배지는 참여 버튼과 겹치면 안 됩니다.').toBe(false);
          }).toPass({ timeout: 20_000, intervals: [100, 250, 500] });
        } catch (error) {
          await testInfo.attach('mobile-lobby-room-card-layout-failure', {
            body: await page.screenshot({ fullPage: true }),
            contentType: 'image/png',
          });
          throw error;
        }
      } finally {
        if (roomId) await deleteRoomForQa(roomId);
      }
    });
  });
});
