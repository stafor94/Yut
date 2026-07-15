import { test, expect } from '@playwright/test';
import { expectAppShell } from '../helpers/ui.js';

test.describe('아이템전 모바일 사이드 패널', () => {
  test('방 정보 접기 버튼을 반복 사용해도 윷판 아래에 보유 아이템과 진행 기록을 유지한다', async ({ page }) => {
    await expectAppShell(page);

    await page.evaluate(() => {
      const fixture = document.createElement('div');
      fixture.id = 'qa-mobile-item-log-fixture';
      fixture.className = 'game-shell';
      Object.assign(fixture.style, {
        position: 'fixed', inset: '0', zIndex: '9999', width: '100vw', maxWidth: '100vw',
        padding: '12px', background: '#f8f1e4', overflow: 'auto',
      });

      const toggle = document.createElement('button');
      toggle.dataset.testid = 'fixture-room-info-toggle';
      toggle.type = 'button';
      toggle.setAttribute('aria-expanded', 'true');
      toggle.textContent = '방 정보 접기';

      const gameLayout = document.createElement('section');
      gameLayout.dataset.testid = 'game-screen';
      gameLayout.dataset.roomInfoCollapsed = 'false';
      gameLayout.className = 'game-layout room-info-expanded';

      const playersPanel = document.createElement('aside');
      playersPanel.dataset.testid = 'players-panel';
      playersPanel.className = 'panel players game-players-panel';
      playersPanel.style.minHeight = '120px';
      playersPanel.textContent = '방 정보와 플레이어';

      const boardPanel = document.createElement('section');
      boardPanel.dataset.testid = 'board-panel';
      boardPanel.className = 'panel board-panel';
      boardPanel.style.minHeight = '180px';
      boardPanel.textContent = '윷판';

      const column = document.createElement('div');
      column.dataset.testid = 'game-side-column';
      column.className = 'game-side-column';

      const itemsPanel = document.createElement('aside');
      itemsPanel.dataset.testid = 'owned-items-panel';
      itemsPanel.className = 'panel side game-log-owned-items game-owned-items-panel';
      const itemsHeading = document.createElement('h2');
      itemsHeading.textContent = '보유 아이템';
      const itemGrid = document.createElement('div');
      itemGrid.className = 'item-grid';
      itemGrid.textContent = '아이템 1 · 아이템 2 · 아이템 3';
      itemsPanel.append(itemsHeading, itemGrid);

      const logPanel = document.createElement('aside');
      logPanel.className = 'panel side';
      const header = document.createElement('div');
      header.className = 'log-header';
      const heading = document.createElement('h2');
      heading.textContent = '진행 기록';
      header.append(heading);

      const list = document.createElement('div');
      list.dataset.testid = 'game-log-list';
      list.className = 'log-list scrollable';
      list.style.height = '380px';
      list.style.minHeight = '380px';
      list.style.flex = '0 0 auto';

      ['#005 다섯 번째 진행 기록입니다.', '#004 네 번째 진행 기록입니다.', '#003 세 번째 진행 기록입니다.', '#002 두 번째 진행 기록입니다.', '#001 가장 오래된 첫 번째 진행 기록입니다.'].forEach((text) => {
        const entry = document.createElement('p');
        entry.dataset.testid = 'game-log-entry';
        entry.style.minHeight = '80px';
        entry.textContent = text;
        list.append(entry);
      });

      logPanel.append(header, list);
      column.append(itemsPanel, logPanel);
      gameLayout.append(playersPanel, boardPanel, column);

      let collapsed = false;
      toggle.addEventListener('click', () => {
        collapsed = !collapsed;
        toggle.setAttribute('aria-expanded', String(!collapsed));
        toggle.textContent = collapsed ? '방 정보 펼치기' : '방 정보 접기';
        gameLayout.dataset.roomInfoCollapsed = String(collapsed);
        gameLayout.classList.toggle('room-info-collapsed', collapsed);
        gameLayout.classList.toggle('room-info-expanded', !collapsed);
        if (collapsed) playersPanel.remove();
        else gameLayout.insertBefore(playersPanel, boardPanel);
      });

      fixture.append(toggle, gameLayout);
      document.body.append(fixture);
    });

    const fixture = page.locator('#qa-mobile-item-log-fixture');
    const toggle = fixture.getByTestId('fixture-room-info-toggle');
    const gameLayout = fixture.getByTestId('game-screen');
    const column = fixture.getByTestId('game-side-column');
    const itemsPanel = fixture.getByTestId('owned-items-panel');
    const logList = fixture.getByTestId('game-log-list');
    const logPanel = logList.locator('xpath=ancestor::aside[1]');

    await expect(itemsPanel).toBeVisible();
    await expect(logPanel).toBeVisible();
    await expect(itemsPanel.getByTestId('game-log-list')).toHaveCount(0);
    await expect(logPanel.getByTestId('owned-items-panel')).toHaveCount(0);

    const readPanelLayout = () => gameLayout.evaluate((element) => {
      const players = element.querySelector('[data-testid="players-panel"]');
      const board = element.querySelector('[data-testid="board-panel"]');
      const sideColumn = element.querySelector('[data-testid="game-side-column"]');
      const items = element.querySelector('[data-testid="owned-items-panel"]');
      const list = element.querySelector('[data-testid="game-log-list"]');
      const log = list?.closest('aside');
      if (!(board instanceof HTMLElement) || !(sideColumn instanceof HTMLElement) || !(items instanceof HTMLElement) || !(log instanceof HTMLElement)) {
        throw new Error('모바일 사이드 패널 fixture가 올바르지 않습니다.');
      }
      const layoutBox = element.getBoundingClientRect();
      const playersBox = players instanceof HTMLElement ? players.getBoundingClientRect() : null;
      const boardBox = board.getBoundingClientRect();
      const columnBox = sideColumn.getBoundingClientRect();
      const itemsBox = items.getBoundingClientRect();
      const logBox = log.getBoundingClientRect();
      const columnStyle = getComputedStyle(sideColumn);
      const layoutStyle = getComputedStyle(element);
      return {
        collapsed: element.dataset.roomInfoCollapsed,
        gridColumns: layoutStyle.gridTemplateColumns,
        gridAreas: layoutStyle.gridTemplateAreas,
        layoutWidth: layoutBox.width,
        playersBottom: playersBox?.bottom ?? null,
        boardTop: boardBox.top,
        boardBottom: boardBox.bottom,
        columnTop: columnBox.top,
        columnWidth: columnBox.width,
        itemsWidth: itemsBox.width,
        logWidth: logBox.width,
        columnDisplay: columnStyle.display,
        columnDirection: columnStyle.flexDirection,
        sameParent: items.parentElement === log.parentElement,
        itemsBeforeLog: items.nextElementSibling === log,
        itemsBottom: itemsBox.bottom,
        logTop: logBox.top,
      };
    });

    const expandedLayout = await readPanelLayout();
    expect(expandedLayout.collapsed).toBe('false');
    expect(expandedLayout.gridColumns.split(' '), '세로모드 게임 레이아웃은 한 열이어야 합니다.').toHaveLength(1);
    expect(expandedLayout.gridAreas, '펼침 상태 Grid 영역 순서는 방 정보 → 윷판 → 사이드 패널이어야 합니다.').toBe('"room" "board" "side"');
    expect(expandedLayout.playersBottom, '방 정보가 윷판 위에 있어야 합니다.').not.toBeNull();
    expect(expandedLayout.playersBottom).toBeLessThanOrEqual(expandedLayout.boardTop);
    expect(expandedLayout.boardBottom, '윷판은 보유 아이템·진행 기록보다 먼저 배치되어야 합니다.').toBeLessThanOrEqual(expandedLayout.columnTop);

    for (let iteration = 0; iteration < 3; iteration += 1) {
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-expanded', 'false');
      await expect(gameLayout).toHaveClass(/room-info-collapsed/);
      await expect(gameLayout).toHaveAttribute('data-room-info-collapsed', 'true');
      await expect(gameLayout.getByTestId('players-panel')).toHaveCount(0);

      const collapsedLayout = await readPanelLayout();
      expect(collapsedLayout.gridAreas, '접힘 상태 Grid 영역은 윷판 → 사이드 패널이어야 합니다.').toBe('"board" "side"');
      expect(collapsedLayout.boardBottom, '접기 후 보유 아이템·진행 기록이 윷판 위로 올라오면 안 됩니다.').toBeLessThanOrEqual(collapsedLayout.columnTop);
      expect(Math.abs(collapsedLayout.columnWidth - collapsedLayout.layoutWidth), '접기 후 사이드 열은 게임 영역 전체 너비를 사용해야 합니다.').toBeLessThanOrEqual(1);
      expect(Math.abs(collapsedLayout.itemsWidth - collapsedLayout.columnWidth), '보유 아이템 패널은 전체 너비여야 합니다.').toBeLessThanOrEqual(1);
      expect(Math.abs(collapsedLayout.logWidth - collapsedLayout.columnWidth), '진행 기록 패널은 전체 너비여야 합니다.').toBeLessThanOrEqual(1);

      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-expanded', 'true');
      await expect(gameLayout).toHaveClass(/room-info-expanded/);
      await expect(gameLayout).toHaveAttribute('data-room-info-collapsed', 'false');
      await expect(gameLayout.getByTestId('players-panel')).toBeVisible();

      const restoredLayout = await readPanelLayout();
      expect(restoredLayout.gridAreas).toBe('"room" "board" "side"');
      expect(restoredLayout.playersBottom).not.toBeNull();
      expect(restoredLayout.playersBottom).toBeLessThanOrEqual(restoredLayout.boardTop);
      expect(restoredLayout.boardBottom).toBeLessThanOrEqual(restoredLayout.columnTop);
    }

    const finalLayout = await readPanelLayout();
    expect(finalLayout.columnDisplay).toBe('flex');
    expect(finalLayout.columnDirection).toBe('column');
    expect(finalLayout.sameParent, '보유 아이템과 진행 기록은 같은 사이드 열의 별도 패널이어야 합니다.').toBe(true);
    expect(finalLayout.itemsBeforeLog, '보유 아이템 패널은 진행 기록 패널 바로 위에 있어야 합니다.').toBe(true);
    expect(finalLayout.itemsBottom, '두 패널이 겹치면 안 됩니다.').toBeLessThanOrEqual(finalLayout.logTop);

    const initialLogLayout = await logList.evaluate((element) => {
      const entries = Array.from(element.querySelectorAll('[data-testid="game-log-entry"]'));
      if (entries.length < 4) throw new Error('진행 기록 fixture가 올바르지 않습니다.');
      const listBox = element.getBoundingClientRect();
      const fourthBox = entries[3].getBoundingClientRect();
      return {
        fourthBottom: fourthBox.bottom,
        listBottom: listBox.bottom,
        scrollHeight: element.scrollHeight,
        clientHeight: element.clientHeight,
      };
    });

    expect(initialLogLayout.fourthBottom, '네 번째 진행 기록이 목록 아래에서 잘리면 안 됩니다.').toBeLessThanOrEqual(initialLogLayout.listBottom + 1);
    expect(initialLogLayout.scrollHeight, '다섯 번째 기록부터 내부 스크롤이 생겨야 합니다.').toBeGreaterThan(initialLogLayout.clientHeight);

    await logList.evaluate((element) => new Promise((resolve) => {
      element.scrollTop = element.scrollHeight;
      requestAnimationFrame(() => resolve(undefined));
    }));

    const scrolledLayout = await logList.evaluate((element) => {
      const entries = Array.from(element.querySelectorAll('[data-testid="game-log-entry"]'));
      const lastEntry = entries.at(-1);
      if (!(lastEntry instanceof HTMLElement)) throw new Error('가장 오래된 진행 기록이 없습니다.');
      const listBox = element.getBoundingClientRect();
      const lastBox = lastEntry.getBoundingClientRect();
      return {
        text: lastEntry.textContent,
        scrollTop: element.scrollTop,
        maxScrollTop: element.scrollHeight - element.clientHeight,
        lastTop: lastBox.top,
        lastBottom: lastBox.bottom,
        visibleTop: listBox.top,
        visibleBottom: listBox.bottom,
      };
    });

    expect(scrolledLayout.text).toContain('#001');
    expect(scrolledLayout.scrollTop).toBeGreaterThan(0);
    expect(Math.abs(scrolledLayout.scrollTop - scrolledLayout.maxScrollTop)).toBeLessThanOrEqual(1);
    expect(scrolledLayout.lastTop).toBeGreaterThanOrEqual(scrolledLayout.visibleTop - 1);
    expect(scrolledLayout.lastBottom).toBeLessThanOrEqual(scrolledLayout.visibleBottom + 1);
  });
});
