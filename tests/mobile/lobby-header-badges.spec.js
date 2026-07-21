import { test, expect } from '@playwright/test';
import { hasFirebaseConfig, makeQaName, normalizeQaNickname } from '../helpers/env.js';
import { deleteRoomForQa, findRoomIdByTitle, rememberRoomIdFromPage } from '../helpers/rooms.js';
import { collectScreenState, createRoomFromLobby, expectAppShell, primeLobbyStorage, runQaStep, waitForBlockingOverlayToDisappear } from '../helpers/ui.js';

async function readHeaderBadgeLayout(page, screenClass) {
  return page.evaluate((targetScreenClass) => {
    const header = document.querySelector(`.${targetScreenClass} > .hero.panel`);
    const actions = header?.querySelector('.hero-actions');
    const nickname = actions?.querySelector('.nickname-chip');
    const sound = actions?.querySelector('.sound-toggle');
    const status = actions?.querySelector('.status-card');
    const end = header instanceof HTMLElement
      ? Array.from(header.children).find((element) => element.classList.contains('game-end-button'))
      : null;
    const controls = [nickname, sound, status, end].filter((control) => control instanceof HTMLElement);
    if (!(header instanceof HTMLElement) || !(actions instanceof HTMLElement) || !(nickname instanceof HTMLElement) || !(sound instanceof HTMLElement) || !(status instanceof HTMLElement)) return null;

    const rect = (element) => {
      const box = element.getBoundingClientRect();
      return { x: box.x, y: box.y, width: box.width, height: box.height, right: box.right, bottom: box.bottom };
    };
    const style = (element) => {
      const computed = getComputedStyle(element);
      return {
        height: Number.parseFloat(computed.height),
        borderRadius: computed.borderRadius,
        borderTopWidth: computed.borderTopWidth,
        fontSize: Number.parseFloat(computed.fontSize),
        justifyContent: computed.justifyContent,
        textAlign: computed.textAlign,
      };
    };
    const orderedControls = [
      ...Array.from(actions.children),
      ...(end instanceof HTMLElement ? [end] : []),
    ];

    return {
      actionDisplay: getComputedStyle(actions).display,
      actionGap: Number.parseFloat(getComputedStyle(actions).columnGap),
      endGap: Number.parseFloat(getComputedStyle(header).columnGap),
      soundLabel: sound.querySelector('.sound-label')?.textContent?.trim() ?? '',
      chevrons: header.querySelectorAll('.lobby-chip-chevron, .lobby-status-chevron').length,
      controlStyles: controls.map(style),
      nickname: rect(nickname),
      sound: rect(sound),
      status: rect(status),
      end: end instanceof HTMLElement ? rect(end) : null,
      controlOrder: orderedControls.map((element) => {
        if (element.classList.contains('nickname-chip')) return 'nickname';
        if (element.classList.contains('sound-toggle')) return 'sound';
        if (element.classList.contains('status-card')) return 'status';
        if (element.classList.contains('game-end-button')) return 'end';
        return 'other';
      }),
      documentClientWidth: document.documentElement.clientWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
    };
  }, screenClass);
}

function expectUniformControlPresentation(layout) {
  expect(layout, '상단 배지 레이아웃을 읽을 수 있어야 합니다.').not.toBeNull();
  expect(layout.actionDisplay, '상단 배지는 공통 grid 레이아웃을 사용해야 합니다.').toBe('grid');
  expect(layout.chevrons, '상단 배지에는 장식용 특수문자가 없어야 합니다.').toBe(0);
  expect(layout.soundLabel, '모든 화면의 소리 배지는 로비와 동일한 라벨을 사용해야 합니다.').toBe('효과음');
  expect(new Set(layout.controlStyles.map((value) => value.height)).size, '한 화면의 상단 배지 높이는 같아야 합니다.').toBe(1);
  expect(new Set(layout.controlStyles.map((value) => value.borderRadius)).size, '한 화면의 상단 배지 모서리 형태는 같아야 합니다.').toBe(1);
  expect(new Set(layout.controlStyles.map((value) => value.fontSize)).size, '한 화면의 상단 배지 글자 크기는 같아야 합니다.').toBe(1);
  layout.controlStyles.forEach((value) => {
    expect(value.justifyContent, '상단 배지 내용은 가로 중앙 정렬되어야 합니다.').toBe('center');
    expect(value.textAlign, '상단 배지 텍스트는 중앙 정렬되어야 합니다.').toBe('center');
  });
  expect(layout.documentScrollWidth, '상단 배지는 가로 문서 스크롤을 만들면 안 됩니다.').toBeLessThanOrEqual(layout.documentClientWidth + 1);
}

function expectLobbyPresentationMatch(lobby, target) {
  const lobbyStyle = lobby.controlStyles[0];
  target.controlStyles.forEach((value) => {
    expect(value.height, '상단 배지 높이는 로비와 같아야 합니다.').toBeCloseTo(lobbyStyle.height, 1);
    expect(value.borderRadius, '상단 배지 모서리 형태는 로비와 같아야 합니다.').toBe(lobbyStyle.borderRadius);
    expect(value.borderTopWidth, '상단 배지 테두리 두께는 로비와 같아야 합니다.').toBe(lobbyStyle.borderTopWidth);
    expect(value.fontSize, '상단 배지 글자 크기는 로비와 같아야 합니다.').toBeCloseTo(lobbyStyle.fontSize, 1);
  });
}

test.describe('mobile shared header badge QA', () => {
  test('로비 상단 배지의 문자·폰트·정렬을 통일한다', async ({ page, context }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 780 });
    await primeLobbyStorage(context, { nickname: '배지정렬QA' });

    await runQaStep(testInfo, '로비 상단 배지 문자·폰트·정렬 확인', async () => {
      await expectAppShell(page);
      await waitForBlockingOverlayToDisappear(page);

      const lobbyLayout = await readHeaderBadgeLayout(page, 'screen-lobby');
      expectUniformControlPresentation(lobbyLayout);
      expect(lobbyLayout.controlOrder).toEqual(['nickname', 'sound', 'status']);
    });
  });

  test('대기실과 인게임 상단 배지를 로비 UI로 통일하고 온라인·종료 배치를 유지한다', async ({ page, context }, testInfo) => {
    test.slow();
    expect(await hasFirebaseConfig(), 'Firebase 설정이 없어 대기실·인게임 배지 QA를 실행할 수 없습니다.').toBe(true);
    await page.setViewportSize({ width: 390, height: 780 });
    const nickname = normalizeQaNickname(makeQaName(testInfo, 'header-badge'));
    const roomTitle = makeQaName(testInfo, 'header-badge-room');
    let roomId;

    await primeLobbyStorage(context, {
      nickname,
      maxPlayers: '2',
      playMode: 'individual',
      itemMode: 'false',
      pieceCount: '4',
    });

    await runQaStep(testInfo, '로비·대기실·인게임 공통 상단 배지와 종료 버튼 배치 확인', async () => {
      try {
        await expectAppShell(page);
        await waitForBlockingOverlayToDisappear(page);
        const lobbyLayout = await readHeaderBadgeLayout(page, 'screen-lobby');
        expectUniformControlPresentation(lobbyLayout);

        await createRoomFromLobby(page, roomTitle);
        roomId = await rememberRoomIdFromPage(page) ?? await findRoomIdByTitle(roomTitle);
        expect(roomId, '생성된 QA 방 ID가 필요합니다.').toBeTruthy();

        const waitingLayout = await readHeaderBadgeLayout(page, 'screen-waitingRoom');
        expectUniformControlPresentation(waitingLayout);
        expectLobbyPresentationMatch(lobbyLayout, waitingLayout);
        expect(waitingLayout.controlOrder).toEqual(['nickname', 'sound', 'status']);
        expect(waitingLayout.status.width, '대기실 온라인 배지 폭은 로비와 같아야 합니다.').toBeCloseTo(lobbyLayout.status.width, 1);

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
          message: 'AI 추가 동기화가 완료되어 게임 시작 버튼이 활성화되어야 합니다.',
        }).toEqual({ pendingAiSeatCount: 0, allReady: true, startDisabled: false });

        await page.getByTestId('start-game-button').click();
        await expect(page.getByTestId('game-screen')).toBeVisible({ timeout: 25_000 });
        await expect(page.getByTestId('game-end-button')).toBeVisible();

        const gameLayout = await readHeaderBadgeLayout(page, 'screen-game');
        expectUniformControlPresentation(gameLayout);
        expectLobbyPresentationMatch(lobbyLayout, gameLayout);
        expect(gameLayout.controlOrder).toEqual(['nickname', 'sound', 'status', 'end']);
        expect(gameLayout.end, '인게임 종료 버튼 배치를 읽을 수 있어야 합니다.').not.toBeNull();
        expect(gameLayout.status.width * 2, '인게임 온라인 배지는 로비·대기실 온라인 배지의 절반 폭이어야 합니다.').toBeCloseTo(waitingLayout.status.width, 1);
        expect(gameLayout.end.width, '종료 버튼은 축소된 온라인 배지와 같은 폭이어야 합니다.').toBeCloseTo(gameLayout.status.width, 1);
        expect(gameLayout.end.height, '종료 버튼은 온라인 배지와 같은 높이여야 합니다.').toBeCloseTo(gameLayout.status.height, 1);
        expect(gameLayout.end.x, '종료 버튼은 온라인 배지 바로 오른쪽에 있어야 합니다.').toBeCloseTo(gameLayout.status.right + gameLayout.endGap, 1);
      } finally {
        if (roomId) await deleteRoomForQa(roomId);
      }
    });
  });
});
