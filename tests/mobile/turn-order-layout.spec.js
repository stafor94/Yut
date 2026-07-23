import { test, expect } from '@playwright/test';
import { collectScreenState, createRoomFromLobby, primeLobbyStorage, runQaStep } from '../helpers/ui.js';
import { makeQaName, normalizeQaNickname } from '../helpers/env.js';
import { deleteRoomForQa, findRoomIdByTitle, rememberRoomIdFromPage } from '../helpers/rooms.js';

function boxesOverlap(a, b) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

const readOverlayLayout = (overlay) => overlay.evaluate((element) => {
  const toBox = (target) => {
    const rect = target.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  };
  const grid = element.querySelector('[data-testid="turn-order-result-grid"]');
  const gridStyle = grid ? getComputedStyle(grid) : null;
  const style = getComputedStyle(element);
  return {
    rect: toBox(element),
    viewport: { width: window.innerWidth, height: window.innerHeight },
    bodyScrollWidth: document.documentElement.scrollWidth,
    borderWidth: Number.parseFloat(style.borderTopWidth),
    backgroundImage: style.backgroundImage,
    gridBox: grid ? toBox(grid) : null,
    gridColumns: gridStyle?.gridTemplateColumns ?? '',
    cardBoxes: Array.from(element.querySelectorAll('.turn-order-result-card')).map(toBox),
  };
});

test.describe('turn-order mobile layout QA', () => {
  let roomId = '';

  test.afterEach(async () => {
    if (roomId) await deleteRoomForQa(roomId);
    roomId = '';
  });

  test('Galaxy 세로 화면에서 순서 정하기·인게임 상단·진행 기록 레이아웃을 검증한다', async ({ page, context }, testInfo) => {
    const nickname = normalizeQaNickname(makeQaName(testInfo, 'turn-order-mobile'));
    const roomTitle = makeQaName(testInfo, 'turn-order-mobile-room');
    await primeLobbyStorage(context, {
      nickname,
      maxPlayers: '2',
      playMode: 'individual',
      itemMode: 'false',
      pieceCount: '4',
    });
    await context.addInitScript(() => {
      window.__YUT_QA_TURN_ORDER_RESULT_QUEUE__ = ['모', '걸'];
    });

    await runQaStep(testInfo, '순서 정하기 오버레이 모바일 경계 확인', async () => {
      await createRoomFromLobby(page, roomTitle);
      roomId = await rememberRoomIdFromPage(page) ?? await findRoomIdByTitle(roomTitle);
      await page.getByTestId('add-ai-P2').click();
      await expect(page.getByTestId('start-game-button')).toBeEnabled({ timeout: 15_000 });
      await page.getByTestId('start-game-button').click();
      await expect(page.getByTestId('game-screen')).toBeVisible({ timeout: 25_000 });

      const overlay = page.getByTestId('turn-order-overlay');
      await expect(overlay).toBeVisible();
      await expect(page.getByTestId('turn-order-preparing')).toBeVisible({ timeout: 5_000 });
      let layout = await readOverlayLayout(overlay);
      expect(layout.rect.x).toBeGreaterThanOrEqual(0);
      expect(layout.rect.y).toBeGreaterThanOrEqual(0);
      expect(layout.rect.x + layout.rect.width).toBeLessThanOrEqual(layout.viewport.width + 1);
      expect(layout.rect.y + layout.rect.height).toBeLessThanOrEqual(layout.viewport.height + 1);
      expect(layout.bodyScrollWidth).toBeLessThanOrEqual(layout.viewport.width + 1);

      const rollButton = page.getByTestId('turn-order-roll-button');
      await expect(rollButton).toBeVisible({ timeout: 10_000 });
      await expect(page.getByTestId('turn-order-timing-panel')).toBeVisible();
      await expect(page.locator('.turn-order-timing-track')).toHaveCount(0);
      await expect(page.locator('.roll-timing-meter')).toBeVisible();
      await expect(page.locator('.roll-timing-orb')).toBeVisible();
      await expect(rollButton).toHaveClass(/roll-button/);
      await rollButton.click();
      await expect(page.getByTestId('turn-order-own-result')).toContainText('모');
      await expect(page.getByTestId('turn-order-result-grid')).toBeVisible();
      await overlay.scrollIntoViewIfNeeded();
      await expect(page.getByTestId('turn-indicator')).toBeHidden();

      layout = await readOverlayLayout(overlay);
      expect(layout.borderWidth, '순서 정하기 팝업은 두꺼운 목재 프레임을 사용해야 합니다.').toBeGreaterThanOrEqual(5);
      expect(layout.backgroundImage, '순서 정하기 팝업은 입체 그라데이션 표면을 사용해야 합니다.').toContain('gradient');
      expect(layout.gridColumns.split(' ').filter(Boolean).length).toBe(2);
      expect(layout.rect.x, '순서 정하기 팝업 왼쪽이 뷰포트 밖으로 나가면 안 됩니다.').toBeGreaterThanOrEqual(0);
      expect(layout.rect.y, '순서 정하기 팝업 위쪽이 뷰포트 밖으로 나가면 안 됩니다.').toBeGreaterThanOrEqual(0);
      expect(layout.rect.x + layout.rect.width, '순서 정하기 팝업 오른쪽이 뷰포트 밖으로 나가면 안 됩니다.').toBeLessThanOrEqual(layout.viewport.width + 1);
      expect(layout.rect.y + layout.rect.height, '순서 정하기 팝업 아래쪽이 뷰포트 밖으로 나가면 안 됩니다.').toBeLessThanOrEqual(layout.viewport.height + 1);
      expect(layout.bodyScrollWidth).toBeLessThanOrEqual(layout.viewport.width + 1);
      expect(layout.gridBox, '동시 윷 던지기 결과 그리드가 있어야 합니다.').not.toBeNull();
      expect(layout.cardBoxes.length, '2인 순서 정하기에는 결과 카드 2개가 있어야 합니다.').toBe(2);
      expect(layout.gridBox.x, '결과 그리드가 팝업 왼쪽 밖으로 나가면 안 됩니다.').toBeGreaterThanOrEqual(layout.rect.x);
      expect(layout.gridBox.x + layout.gridBox.width, '결과 그리드가 팝업 오른쪽 밖으로 나가면 안 됩니다.').toBeLessThanOrEqual(layout.rect.x + layout.rect.width);
      for (let index = 0; index < layout.cardBoxes.length; index += 1) {
        const box = layout.cardBoxes[index];
        expect(box.x, '결과 카드가 그리드 왼쪽 밖으로 나가면 안 됩니다.').toBeGreaterThanOrEqual(layout.gridBox.x);
        expect(box.x + box.width, '결과 카드가 그리드 오른쪽 밖으로 나가면 안 됩니다.').toBeLessThanOrEqual(layout.gridBox.x + layout.gridBox.width);
        if (index > 0) expect(boxesOverlap(layout.cardBoxes[index - 1], box), '순서 결과 카드끼리 겹치면 안 됩니다.').toBe(false);
      }
    });

    await runQaStep(testInfo, '모바일 인게임 상단과 플레이어 목록 접기 레이아웃 확인', async () => {
      const header = page.locator('.game-shell .hero');
      const playersPanel = page.getByTestId('players-panel');
      const expandedToggle = page.getByTestId('game-room-info-toggle');
      const playTimer = page.getByTestId('play-timer');
      await expect(header).toBeVisible();
      await expect(playersPanel).toBeVisible();
      await expect(expandedToggle).toBeVisible();
      await expect(expandedToggle).toHaveAttribute('aria-expanded', 'true');
      await expect(expandedToggle).toHaveText('▲접기');
      await expect(playTimer).toBeVisible();
      await expect(page.getByTestId('owned-items-panel')).toHaveCount(0);

      const expandedLayout = await page.locator('.game-shell').evaluate((shell) => {
        const headerElement = shell.querySelector('.hero');
        const playerPanelElement = shell.querySelector('[data-testid="players-panel"]');
        const toggleElement = playerPanelElement?.querySelector('[data-testid="game-room-info-toggle"]');
        const actions = headerElement?.querySelector('.hero-actions');
        const buttons = actions ? Array.from(actions.querySelectorAll('button')) : [];
        const nicknameButton = actions?.querySelector('.nickname-chip');
        const toBox = (target) => {
          if (!target) return null;
          const rect = target.getBoundingClientRect();
          return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
        };
        return {
          headerDisplay: headerElement ? getComputedStyle(headerElement).display : '',
          headerBox: toBox(headerElement),
          actionsBox: toBox(actions),
          playerPanelBox: toBox(playerPanelElement),
          toggleBox: toBox(toggleElement),
          toggleText: toggleElement?.textContent ?? '',
          toggleColor: toggleElement ? getComputedStyle(toggleElement).color : '',
          nicknameBox: toBox(nicknameButton),
          buttonBoxes: buttons.map(toBox),
          toggleInHeaderCount: headerElement?.querySelectorAll('[data-testid="game-room-info-toggle"]').length ?? 0,
          headerTimerCount: headerElement?.querySelectorAll('.play-time').length ?? 0,
        };
      });

      expect(expandedLayout.headerDisplay, '인게임 상단은 명시적인 grid 레이아웃이어야 합니다.').toBe('grid');
      expect(expandedLayout.headerBox, '상단 패널 bounding box').not.toBeNull();
      expect(expandedLayout.actionsBox, '상단 액션 영역 bounding box').not.toBeNull();
      expect(expandedLayout.playerPanelBox, '플레이어 패널 bounding box').not.toBeNull();
      expect(expandedLayout.toggleBox, '접기 탭 bounding box').not.toBeNull();
      expect(expandedLayout.nicknameBox, '닉네임 버튼 bounding box').not.toBeNull();
      expect(expandedLayout.buttonBoxes, '닉네임·효과음·서버 상태 버튼 3개가 액션 영역에 있어야 합니다.').toHaveLength(3);
      expect(expandedLayout.toggleInHeaderCount, '펼침 상태 접기 탭은 상단 패널에 남아 있으면 안 됩니다.').toBe(0);
      expect(expandedLayout.headerTimerCount, '플레이 타이머는 상단이 아니라 진행 기록 헤더에 있어야 합니다.').toBe(0);
      expect(expandedLayout.toggleText).toBe('▲접기');
      expect(expandedLayout.toggleColor).toBe('rgb(79, 45, 25)');
      const playerPanelCenter = expandedLayout.playerPanelBox.x + expandedLayout.playerPanelBox.width / 2;
      const expandedToggleCenter = expandedLayout.toggleBox.x + expandedLayout.toggleBox.width / 2;
      const playerPanelBottom = expandedLayout.playerPanelBox.y + expandedLayout.playerPanelBox.height;
      expect(Math.abs(expandedToggleCenter - playerPanelCenter), '접기 탭은 플레이어 목록 패널 하단 중앙에 있어야 합니다.').toBeLessThanOrEqual(1);
      expect(expandedLayout.toggleBox.y, '접기 탭 위쪽은 플레이어 패널 안쪽에 걸쳐야 합니다.').toBeLessThan(playerPanelBottom);
      expect(expandedLayout.toggleBox.y + expandedLayout.toggleBox.height, '접기 탭 아래쪽은 플레이어 패널 테두리 아래로 내려와야 합니다.').toBeGreaterThan(playerPanelBottom);
      expect(expandedLayout.nicknameBox.width, '상단 닉네임 버튼은 접기 탭과 무관하게 확보된 너비를 사용해야 합니다.').toBeGreaterThan(expandedLayout.buttonBoxes[1].width + 20);
      const firstCenterY = expandedLayout.buttonBoxes[0].y + expandedLayout.buttonBoxes[0].height / 2;
      for (const buttonBox of expandedLayout.buttonBoxes) {
        expect(buttonBox.x, '상단 버튼이 액션 영역 왼쪽 밖으로 나가면 안 됩니다.').toBeGreaterThanOrEqual(expandedLayout.actionsBox.x - 1);
        expect(buttonBox.x + buttonBox.width, '상단 버튼이 액션 영역 오른쪽 밖으로 나가면 안 됩니다.').toBeLessThanOrEqual(expandedLayout.actionsBox.x + expandedLayout.actionsBox.width + 1);
        expect(Math.abs((buttonBox.y + buttonBox.height / 2) - firstCenterY), '상단 버튼은 같은 행의 중앙선에 정렬되어야 합니다.').toBeLessThanOrEqual(1);
      }
      for (let leftIndex = 0; leftIndex < expandedLayout.buttonBoxes.length; leftIndex += 1) {
        for (let rightIndex = leftIndex + 1; rightIndex < expandedLayout.buttonBoxes.length; rightIndex += 1) {
          expect(boxesOverlap(expandedLayout.buttonBoxes[leftIndex], expandedLayout.buttonBoxes[rightIndex]), '상단 버튼끼리 겹치면 안 됩니다.').toBe(false);
        }
      }

      await expandedToggle.click();
      await expect(page.getByTestId('players-panel')).toHaveCount(0);
      const collapsedToggle = page.getByTestId('game-room-info-toggle');
      await expect(collapsedToggle).toBeVisible();
      await expect(collapsedToggle).toHaveAttribute('aria-expanded', 'false');
      await expect(collapsedToggle).toHaveText('▼펼치기');
      await expect(page.getByTestId('game-screen')).toHaveAttribute('data-room-info-collapsed', 'true');
      const collapsedLayout = await header.evaluate((element) => {
        const toggleElement = element.querySelector('[data-testid="game-room-info-toggle"]');
        if (!(toggleElement instanceof HTMLElement)) throw new Error('접힘 상태 펼치기 탭을 찾지 못했습니다.');
        const headerBox = element.getBoundingClientRect();
        const toggleBox = toggleElement.getBoundingClientRect();
        const style = getComputedStyle(toggleElement);
        return {
          headerCenter: headerBox.x + headerBox.width / 2,
          headerBottom: headerBox.y + headerBox.height,
          toggleCenter: toggleBox.x + toggleBox.width / 2,
          toggleTop: toggleBox.y,
          toggleBottom: toggleBox.y + toggleBox.height,
          toggleText: toggleElement.textContent,
          toggleColor: style.color,
          toggleBorderColor: style.borderTopColor,
          toggleBackgroundImage: style.backgroundImage,
        };
      });
      expect(Math.abs(collapsedLayout.toggleCenter - collapsedLayout.headerCenter), '펼치기 탭은 최상단 패널 하단 중앙에 있어야 합니다.').toBeLessThanOrEqual(1);
      expect(collapsedLayout.toggleTop, '펼치기 탭 위쪽 절반은 최상단 패널 안쪽에 걸쳐야 합니다.').toBeLessThan(collapsedLayout.headerBottom);
      expect(collapsedLayout.toggleBottom, '펼치기 탭 아래쪽 절반은 최상단 패널 테두리 밖으로 돌출되어야 합니다.').toBeGreaterThan(collapsedLayout.headerBottom);
      expect(collapsedLayout.toggleText).toBe('▼펼치기');
      expect(collapsedLayout.toggleColor).toBe('rgb(79, 45, 25)');
      expect(collapsedLayout.toggleBorderColor).toBe('rgb(141, 90, 45)');
      expect(collapsedLayout.toggleBackgroundImage).toContain('gradient');
      await collapsedToggle.click();
      await expect(page.getByTestId('game-room-info-toggle')).toHaveAttribute('aria-expanded', 'true');
      await expect(page.getByTestId('game-room-info-toggle')).toHaveText('▲접기');
      await expect(page.getByTestId('players-panel')).toBeVisible();
      await expect(page.getByTestId('game-screen')).toHaveAttribute('data-room-info-collapsed', 'false');
    });

    await runQaStep(testInfo, '모바일 진행 기록 4개 표시 높이 확인', async () => {
      await expect.poll(async () => {
        const state = await collectScreenState(page);
        const debug = state.yutDebug ?? {};
        const hasTurnOrder = Array.isArray(debug.turnOrderIds) && debug.turnOrderIds.length >= 2;
        const orderingCleared = !debug.turnOrderPhase?.active && !debug.turnOrderIntro && !state.turnOrder.phaseOverlayVisible && !state.turnOrder.introOverlayVisible && !state.turnOrder.lockVisible;
        return hasTurnOrder && orderingCleared ? 'resolved' : JSON.stringify(state, null, 2);
      }, { timeout: 35_000, message: '순서 정하기가 완료되고 대기/오버레이가 사라져야 합니다.' }).toBe('resolved');

      const logEntries = page.getByTestId('game-log-entry');
      const logList = page.getByTestId('game-log-list');
      await expect(logList).toBeVisible();
      await expect(logEntries.first(), '초기 순서 진행 기록이 표시되어야 합니다.').toBeVisible();
      await logList.evaluate((element) => {
        const sourceEntry = element.querySelector('[data-testid="game-log-entry"]');
        if (!(sourceEntry instanceof HTMLElement)) throw new Error('진행 기록 레이아웃 fixture의 기준 카드가 없습니다.');
        const currentEntries = Array.from(element.querySelectorAll('[data-testid="game-log-entry"]'));
        for (let index = currentEntries.length; index < 5; index += 1) {
          const clone = sourceEntry.cloneNode(true);
          if (!(clone instanceof HTMLElement)) continue;
          clone.dataset.qaLogLayoutFixture = String(index + 1);
          const sequence = clone.querySelector('.log-sequence');
          if (sequence) sequence.textContent = `${index + 1}.`;
          clone.append(document.createTextNode(` 모바일 진행 기록 높이 검증 ${index + 1}`));
          element.appendChild(clone);
        }
      });
      await expect.poll(() => logEntries.count(), { timeout: 2_000, message: '레이아웃 검증용 진행 기록 5개가 준비되어야 합니다.' }).toBeGreaterThanOrEqual(5);
      await expect.poll(async () => logList.evaluate((element) => Number.parseFloat(element.style.height) || 0), {
        timeout: 2_000,
        message: '모바일 진행 기록 높이가 첫 4개 카드 기준으로 계산되어야 합니다.',
      }).toBeGreaterThan(0);
      const layout = await logList.evaluate((element) => {
        const toBox = (target) => {
          const rect = target.getBoundingClientRect();
          return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
        };
        const entries = Array.from(element.querySelectorAll('[data-testid="game-log-entry"]'));
        return {
          listBox: toBox(element),
          entryBoxes: entries.slice(0, 4).map(toBox),
          entryCount: entries.length,
          clientHeight: element.clientHeight,
          scrollHeight: element.scrollHeight,
          overflowY: getComputedStyle(element).overflowY,
        };
      });
      expect(layout.entryBoxes).toHaveLength(4);
      expect(layout.entryBoxes[3].y + layout.entryBoxes[3].height, '네 번째 진행 기록이 스크롤 영역 아래에서 잘리면 안 됩니다.').toBeLessThanOrEqual(layout.listBox.y + layout.listBox.height + 1);
      expect(layout.entryCount, '다섯 번째 진행 기록까지 fixture가 유지되어야 합니다.').toBeGreaterThanOrEqual(5);
      expect(layout.scrollHeight, '다섯 번째 진행 기록부터는 스크롤로 접근할 수 있어야 합니다.').toBeGreaterThan(layout.clientHeight);
      expect(['auto', 'scroll'], '모바일 진행 기록 목록은 세로 스크롤을 허용해야 합니다.').toContain(layout.overflowY);
      await logList.evaluate((element) => {
        element.querySelectorAll('[data-qa-log-layout-fixture]').forEach((node) => node.remove());
      });
    });
  });
});
