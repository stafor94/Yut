import { test, expect } from '@playwright/test';
import { createRoomFromLobby, expectAppShell, joinRoomFromLobby, primeLobbyStorage, runQaStep } from '../helpers/ui.js';
import { makeQaName } from '../helpers/env.js';
import { deleteRoomForQa, findRoomIdByTitle, rememberRoomIdFromPage } from '../helpers/rooms.js';

async function readHumanRoleLayout(card) {
  return card.evaluate((element) => {
    const badge = element.querySelector('.human-seat-copy > .seat-role-badge');
    const nickname = element.querySelector('.human-seat-copy > strong');
    if (!(badge instanceof HTMLElement) || !(nickname instanceof HTMLElement)) return null;
    const badgeRect = badge.getBoundingClientRect();
    const nicknameRect = nickname.getBoundingClientRect();
    return {
      badgeText: badge.textContent?.trim() ?? '',
      nicknameText: nickname.textContent?.trim() ?? '',
      badge: { x: badgeRect.x, y: badgeRect.y, width: badgeRect.width, height: badgeRect.height },
      nickname: { x: nicknameRect.x, y: nicknameRect.y, width: nicknameRect.width, height: nicknameRect.height },
    };
  });
}

function expectRoleAboveNickname(layout, expectedRole, expectedNickname) {
  expect(layout, `${expectedRole} 역할 배지와 닉네임을 읽을 수 있어야 합니다.`).not.toBeNull();
  expect(layout.badgeText).toBe(expectedRole);
  expect(layout.nicknameText).toBe(expectedNickname);
  expect(Math.abs(layout.badge.x - layout.nickname.x), `${expectedRole} 배지와 닉네임의 왼쪽 좌표가 같아야 합니다.`).toBeLessThanOrEqual(1);
  expect(layout.badge.y + layout.badge.height, `${expectedRole} 배지는 닉네임 위에 있어야 합니다.`).toBeLessThanOrEqual(layout.nickname.y + 1);
}

test.describe('requested waiting-room title and role layout QA', () => {
  test('방 제목 입력은 모바일과 태블릿에서 20글자를 넘지 않는다', async ({ page, context }, testInfo) => {
    await primeLobbyStorage(context, { nickname: '제목제한QA' });
    await runQaStep(testInfo, '방 제목 20글자 입력 제한 확인', async () => {
      await expectAppShell(page);
      await page.getByRole('button', { name: '방 만들기', exact: true }).click();
      const input = page.getByTestId('room-title-input');
      const expectedTitle = '가'.repeat(20);
      await input.fill(`${expectedTitle}나`);
      await expect(input).toHaveValue(expectedTitle);
    });
  });

  test('방 제목·설정 옵션·팀 색상·사람 역할 배지가 모바일 대기실 카드 안에 정상 배치된다', async ({ page, context, browser }, testInfo) => {
    test.slow();
    const hostNickname = '방장검증';
    const guestNickname = '참가검증';
    const roomTitle = makeQaName(testInfo, 'title-role-room');
    let roomId;
    let guestContext;

    await primeLobbyStorage(context, { nickname: hostNickname, maxPlayers: '2', playMode: 'individual', itemMode: 'false', pieceCount: '4' });
    await runQaStep(testInfo, '방 설정 카드, 팀 색상과 사람 역할 배지 geometry 확인', async () => {
      try {
        await createRoomFromLobby(page, roomTitle);
        roomId = await rememberRoomIdFromPage(page) ?? await findRoomIdByTitle(roomTitle);

        const setupCard = page.locator('.waiting-setup-card');
        const settingsToggle = page.getByTestId('waiting-room-settings-toggle');
        await expect(page.locator('.waiting-header')).toHaveCount(0);
        await expect(setupCard.locator('.waiting-room-title-block')).toHaveCount(0);
        await expect(setupCard.getByText('방 제목', { exact: true })).toHaveCount(0);
        await expect(settingsToggle.getByTestId('waiting-room-title')).toHaveText(roomTitle);
        await expect(page.getByTestId('waiting-room-title')).toHaveCount(1);
        await expect(settingsToggle).toHaveAttribute('aria-expanded', 'true');
        await expect(page.getByRole('group', { name: '진행' })).toBeVisible();

        const settingsLayout = await setupCard.evaluate((element) => {
          const title = element.querySelector('[data-testid="waiting-room-title"]');
          const progressLegend = element.querySelector('.play-mode-group legend');
          const stackedOff = element.querySelector('.stacked-roll-mode-group label:has(input:checked)');
          const settingsContent = element.querySelector('.waiting-settings-content');
          if (!(title instanceof HTMLElement) || !(progressLegend instanceof HTMLElement) || !(stackedOff instanceof HTMLElement) || !(settingsContent instanceof HTMLElement)) return null;
          const box = (target) => {
            const rect = target.getBoundingClientRect();
            return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
          };
          const cardBox = box(element);
          const cardStyle = getComputedStyle(element);
          const contentStyle = getComputedStyle(settingsContent);
          const innerLeft = cardBox.left + Number.parseFloat(cardStyle.borderLeftWidth) + Number.parseFloat(cardStyle.paddingLeft);
          const innerRight = cardBox.right - Number.parseFloat(cardStyle.borderRightWidth) - Number.parseFloat(cardStyle.paddingRight);
          return {
            card: cardBox,
            title: box(title),
            progressLegend: box(progressLegend),
            stackedOff: box(stackedOff),
            stackedOffText: stackedOff.textContent?.trim() ?? '',
            innerLeft,
            innerRight,
            cardOverflow: cardStyle.overflow,
            contentOverflow: contentStyle.overflow,
            clientWidth: document.documentElement.clientWidth,
            scrollWidth: document.documentElement.scrollWidth,
          };
        });

        expect(settingsLayout, '방 설정 카드 내부 geometry를 읽을 수 있어야 합니다.').not.toBeNull();
        for (const key of ['title', 'progressLegend', 'stackedOff']) {
          const target = settingsLayout[key];
          expect(target.left, `${key} 왼쪽이 카드 밖으로 잘리면 안 됩니다.`).toBeGreaterThanOrEqual(settingsLayout.card.left - 1);
          expect(target.right, `${key} 오른쪽이 카드 밖으로 잘리면 안 됩니다.`).toBeLessThanOrEqual(settingsLayout.card.right + 1);
          expect(target.top, `${key} 위쪽이 카드 밖으로 잘리면 안 됩니다.`).toBeGreaterThanOrEqual(settingsLayout.card.top - 1);
          expect(target.bottom, `${key} 아래쪽이 카드 밖으로 잘리면 안 됩니다.`).toBeLessThanOrEqual(settingsLayout.card.bottom + 1);
        }
        for (const key of ['progressLegend', 'stackedOff']) {
          const target = settingsLayout[key];
          expect(target.left, `${key} 왼쪽이 카드의 둥근 모서리 안쪽 여백을 침범하면 안 됩니다.`).toBeGreaterThanOrEqual(settingsLayout.innerLeft - 1);
          expect(target.right, `${key} 오른쪽이 카드의 둥근 모서리 안쪽 여백을 침범하면 안 됩니다.`).toBeLessThanOrEqual(settingsLayout.innerRight + 1);
        }
        expect(settingsLayout.cardOverflow).toBe('visible');
        expect(settingsLayout.contentOverflow).toBe('visible');
        expect(settingsLayout.stackedOffText).toBe('OFF');
        expect(settingsLayout.scrollWidth, '방 설정 옵션 때문에 가로 스크롤이 생기면 안 됩니다.').toBeLessThanOrEqual(settingsLayout.clientWidth);

        const hostCard = page.locator('.compact-ready-card').filter({ hasText: 'P1' }).first();
        await expect(hostCard).toContainText(hostNickname);
        expectRoleAboveNickname(await readHumanRoleLayout(hostCard), '방장', hostNickname);

        await page.getByRole('radio', { name: '팀전' }).check();
        await expect(page.getByTestId('waiting-room-settings-summary')).toContainText('팀전');
        const blueTeamCard = page.locator('.compact-ready-card.blue-team').filter({ hasText: 'P1' }).first();
        const redTeamCard = page.locator('.compact-ready-card.red-team').filter({ hasText: 'P2' }).first();
        const activeBlue = blueTeamCard.locator('.team-card-option.blue.active');
        const activeRed = redTeamCard.locator('.team-card-option.red.active');
        await expect(activeBlue).toHaveText('청팀');
        await expect(activeRed).toHaveText('홍팀');
        const teamColors = await Promise.all([
          activeBlue.evaluate((element) => getComputedStyle(element).backgroundColor),
          activeRed.evaluate((element) => getComputedStyle(element).backgroundColor),
        ]);
        expect(teamColors[0]).toBe('rgb(37, 99, 235)');
        expect(teamColors[1]).toBe('rgb(214, 69, 69)');

        guestContext = await browser.newContext({
          baseURL: testInfo.project.use.baseURL,
          viewport: page.viewportSize() ?? { width: 390, height: 844 },
        });
        await primeLobbyStorage(guestContext, { nickname: guestNickname, maxPlayers: '2', playMode: 'individual', itemMode: 'false', pieceCount: '4' });
        const guestPage = await guestContext.newPage();
        await joinRoomFromLobby(guestPage, roomTitle);

        const guestSetupCard = guestPage.locator('.waiting-setup-card');
        const guestSettingsLabel = guestPage.getByTestId('waiting-room-settings-label');
        await expect(guestPage.locator('.waiting-header')).toHaveCount(0);
        await expect(guestSetupCard.locator('.waiting-room-title-block')).toHaveCount(0);
        await expect(guestSettingsLabel.getByTestId('waiting-room-title')).toHaveText(roomTitle);
        await expect(guestPage.getByTestId('waiting-room-settings-toggle')).toHaveCount(0);
        await expect(guestSettingsLabel).toBeVisible();

        const guestHostCard = guestPage.locator('.compact-ready-card').filter({ hasText: 'P1' }).first();
        const guestPlayerCard = guestPage.locator('.compact-ready-card').filter({ hasText: 'P2' }).first();
        await expect(guestHostCard).toContainText(hostNickname);
        await expect(guestPlayerCard).toContainText(guestNickname);
        expectRoleAboveNickname(await readHumanRoleLayout(guestHostCard), '방장', hostNickname);
        expectRoleAboveNickname(await readHumanRoleLayout(guestPlayerCard), '플레이어', guestNickname);
      } finally {
        await guestContext?.close();
        if (roomId) await deleteRoomForQa(roomId);
      }
    });
  });
});
