import { test, expect } from '@playwright/test';
import { createRoomFromLobby, joinRoomFromLobby, primeLobbyStorage, runQaStep } from '../helpers/ui.js';
import { makeQaName, normalizeQaNickname } from '../helpers/env.js';
import { deleteRoomForQa, findRoomIdByTitle, rememberRoomIdFromPage } from '../helpers/rooms.js';

const widths = [360, 390, 412];

async function expectWaitingActionsAligned(page, label) {
  const layout = await page.evaluate(() => {
    const room = document.querySelector('.waiting-room.compact-waiting-room');
    const content = document.querySelector('.waiting-main-grid');
    const actions = document.querySelector('.waiting-actions.role-actions');
    const buttons = Array.from(document.querySelectorAll('.waiting-action-buttons button'));
    if (!(room instanceof HTMLElement) || !(content instanceof HTMLElement) || !(actions instanceof HTMLElement) || buttons.length !== 2) return null;
    const rect = (element) => {
      const box = element.getBoundingClientRect();
      return { left: box.left, right: box.right, width: box.width, top: box.top, bottom: box.bottom };
    };
    const style = getComputedStyle(actions);
    return {
      viewportWidth: window.innerWidth,
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      roomClassName: room.className,
      content: rect(content),
      actions: rect(actions),
      buttons: buttons.map((button) => ({ ...rect(button), text: button.textContent?.trim() ?? '', disabled: button.hasAttribute('disabled') })),
      actionsStyle: {
        position: style.position,
        left: style.left,
        right: style.right,
        bottom: style.bottom,
        inset: style.inset,
        width: style.width,
        marginLeft: style.marginLeft,
        marginRight: style.marginRight,
        transform: style.transform,
        boxSizing: style.boxSizing,
        justifySelf: style.justifySelf,
      },
    };
  });

  expect(layout, `${label}: 대기실 레이아웃 요소를 찾을 수 있어야 합니다.`).not.toBeNull();
  expect(layout.actionsStyle.position, `${label}: 하단 패널은 문서 흐름 안에 있어야 합니다.`).toBe('static');
  expect(layout.actionsStyle.transform, `${label}: 하단 패널 위치 보정 transform을 쓰면 안 됩니다.`).toBe('none');
  expect(layout.actionsStyle.boxSizing, `${label}: 하단 패널 폭 계산은 border-box여야 합니다.`).toBe('border-box');
  expect(Math.abs(layout.actions.left - layout.content.left), `${label}: 하단 패널 왼쪽 좌표는 위 콘텐츠와 같아야 합니다.`).toBeLessThanOrEqual(2);
  expect(Math.abs(layout.actions.right - layout.content.right), `${label}: 하단 패널 오른쪽 좌표는 위 콘텐츠와 같아야 합니다.`).toBeLessThanOrEqual(2);
  expect(layout.actions.left, `${label}: 하단 패널 왼쪽은 viewport 밖으로 나가면 안 됩니다.`).toBeGreaterThanOrEqual(0);
  expect(layout.actions.right, `${label}: 하단 패널 오른쪽은 viewport 밖으로 나가면 안 됩니다.`).toBeLessThanOrEqual(layout.viewportWidth + 1);
  expect(layout.scrollWidth, `${label}: 문서 가로 스크롤이 생기면 안 됩니다.`).toBeLessThanOrEqual(layout.clientWidth);
  expect(Math.abs(layout.buttons[0].width - layout.buttons[1].width), `${label}: 하단 버튼 2개의 폭은 같아야 합니다.`).toBeLessThanOrEqual(2);
  expect(layout.buttons[0].text, `${label}: 첫 번째 액션 버튼 문구`).toMatch(/^(게임 시작|준비 완료|준비 취소|게임중)$/u);
  expect(layout.buttons[1].text, `${label}: 방 나가기 버튼 문구`).toBe('방 나가기');
}

test.describe('mobile waiting room action panel layout', () => {
  test('비방장과 방장 하단 액션 패널이 모바일 콘텐츠 폭에 맞춰 정렬된다', async ({ page, context, browser }, testInfo) => {
    test.slow();
    const hostNickname = normalizeQaNickname(makeQaName(testInfo, 'actions-host'));
    const guestNickname = normalizeQaNickname(makeQaName(testInfo, 'actions-guest'));
    const individualTitle = makeQaName(testInfo, 'actions-individual');
    const teamTitle = makeQaName(testInfo, 'actions-team');
    let individualRoomId;
    let teamRoomId;
    let guestContext;
    let teamHostContext;
    let teamGuestContext;

    await runQaStep(testInfo, '모바일 대기실 하단 액션 패널 정렬 확인', async () => {
      try {
        await page.setViewportSize({ width: 412, height: 915 });
        await primeLobbyStorage(context, { nickname: hostNickname, maxPlayers: '2', playMode: 'individual', itemMode: 'false', pieceCount: '4' });
        await createRoomFromLobby(page, individualTitle);
        individualRoomId = await rememberRoomIdFromPage(page) ?? await findRoomIdByTitle(individualTitle);

        guestContext = await browser.newContext({ baseURL: testInfo.project.use.baseURL, viewport: { width: 412, height: 915 } });
        await primeLobbyStorage(guestContext, { nickname: guestNickname, maxPlayers: '2', playMode: 'individual', itemMode: 'false', pieceCount: '4' });
        const guestPage = await guestContext.newPage();
        await joinRoomFromLobby(guestPage, individualTitle);
        await expect(guestPage.getByRole('button', { name: '준비 완료' })).toBeVisible();
        await expect(guestPage.getByRole('button', { name: '준비 완료' })).toBeEnabled();
        await expect(guestPage.getByRole('button', { name: '방 나가기' })).toBeVisible();
        await expect(guestPage.getByRole('button', { name: '방 나가기' })).toBeEnabled();

        for (const width of widths) {
          await page.setViewportSize({ width, height: 915 });
          await guestPage.setViewportSize({ width, height: 915 });
          await expectWaitingActionsAligned(page, `방장 개인전 ${width}px`);
          await expectWaitingActionsAligned(guestPage, `비방장 개인전 ${width}px`);
        }

        teamHostContext = await browser.newContext({ baseURL: testInfo.project.use.baseURL, viewport: { width: 412, height: 915 } });
        await primeLobbyStorage(teamHostContext, { nickname: `${hostNickname}팀`, maxPlayers: '4', playMode: 'team', itemMode: 'false', pieceCount: '4' });
        const teamHostPage = await teamHostContext.newPage();
        await createRoomFromLobby(teamHostPage, teamTitle);
        teamRoomId = await rememberRoomIdFromPage(teamHostPage) ?? await findRoomIdByTitle(teamTitle);

        teamGuestContext = await browser.newContext({ baseURL: testInfo.project.use.baseURL, viewport: { width: 412, height: 915 } });
        await primeLobbyStorage(teamGuestContext, { nickname: `${guestNickname}팀`, maxPlayers: '4', playMode: 'team', itemMode: 'false', pieceCount: '4' });
        const teamGuestPage = await teamGuestContext.newPage();
        await joinRoomFromLobby(teamGuestPage, teamTitle);
        await expect(teamGuestPage.getByRole('button', { name: '준비 완료' })).toBeVisible();
        await expect(teamGuestPage.getByRole('button', { name: '준비 완료' })).toBeEnabled();
        await expect(teamGuestPage.getByRole('button', { name: '방 나가기' })).toBeVisible();
        await expect(teamGuestPage.getByRole('button', { name: '방 나가기' })).toBeEnabled();

        for (const width of widths) {
          await teamGuestPage.setViewportSize({ width, height: 915 });
          await expectWaitingActionsAligned(teamGuestPage, `비방장 팀전 ${width}px`);
        }
      } finally {
        await guestContext?.close();
        await teamGuestContext?.close();
        await teamHostContext?.close();
        if (individualRoomId) await deleteRoomForQa(individualRoomId);
        if (teamRoomId) await deleteRoomForQa(teamRoomId);
      }
    });
  });
});
