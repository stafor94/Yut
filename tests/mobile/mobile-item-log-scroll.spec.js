import { test, expect } from '@playwright/test';

test.describe('아이템전 모바일 사이드 패널', () => {
  test('보유 아이템과 진행 기록을 전체 너비로 배치하고 접힘 상태에서도 윷판 아래 순서를 유지한다', async ({ page }) => {
    await page.goto('/');
    await page.setViewportSize({ width: 390, height: 844 });

    await page.evaluate(() => {
      const fixture = document.createElement('div');
      fixture.id = 'qa-mobile-item-log-fixture';
      fixture.className = 'game-shell';
      Object.assign(fixture.style, {
        position: 'fixed', inset: '0', zIndex: '9999', width: '390px', maxWidth: '100vw',
        padding: '12px', background: '#f8f1e4', overflow: 'auto',
      });

      const gameLayout = document.createElement('section');
      gameLayout.dataset.testid = 'game-screen';
      gameLayout.className = 'game-layout';

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
      gameLayout.append(boardPanel, column);
      fixture.append(gameLayout);
      document.body.append(fixture);
    });

    const fixture = page.locator('#qa-mobile-item-log-fixture');
    const gameLayout = fixture.getByTestId('game-screen');
    const column = fixture.getByTestId('game-side-column');
    const itemsPanel = fixture.getByTestId('owned-items-panel');
    const logList = fixture.getByTestId('game-log-list');
    const logPanel = logList.locator('xpath=ancestor::aside[1]');

    await expect(itemsPanel).toBeVisible();
    await expect(logPanel).toBeVisible();
    await expect(itemsPanel.getByTestId('game-log-list')).toHaveCount(0);
    await expect(logPanel.getByTestId('owned-items-panel')).toHaveCount(0);

    const panelLayout = await gameLayout.evaluate((element) => {
      const board = element.querySelector('[data-testid="board-panel"]');
      const column = element.querySelector('[data-testid="game-side-column"]');
      const items = element.querySelector('[data-testid="owned-items-panel"]');
      const list = element.querySelector('[data-testid="game-log-list"]');
      const log = list?.closest('aside');
      if (!(board instanceof HTMLElement) || !(column instanceof HTMLElement) || !(items instanceof HTMLElement) || !(log instanceof HTMLElement)) {
        throw new Error('모바일 사이드 패널 fixture가 올바르지 않습니다.');
      }
      const layoutBox = element.getBoundingClientRect();
      const boardBox = board.getBoundingClientRect();
      const columnBox = column.getBoundingClientRect();
      const itemsBox = items.getBoundingClientRect();
      const logBox = log.getBoundingClientRect();
      const columnStyle = getComputedStyle(column);
      return {
        gridColumns: getComputedStyle(element).gridTemplateColumns,
        layoutWidth: layoutBox.width,
        columnWidth: columnBox.width,
        itemsWidth: itemsBox.width,
        logWidth: logBox.width,
        boardBottom: boardBox.bottom,
        columnTop: columnBox.top,
        columnDisplay: columnStyle.display,
        columnDirection: columnStyle.flexDirection,
        boardOrder: Number.parseInt(getComputedStyle(board).order, 10),
        columnOrder: Number.parseInt(columnStyle.order, 10),
        sameParent: items.parentElement === log.parentElement,
        itemsBeforeLog: items.nextElementSibling === log,
        itemsBottom: itemsBox.bottom,
        logTop: logBox.top,
      };
    });

    expect(panelLayout.gridColumns.split(' '), '세로모드 게임 레이아웃은 한 열이어야 합니다.').toHaveLength(1);
    expect(Math.abs(panelLayout.columnWidth - panelLayout.layoutWidth), '보유 아이템·진행 기록 열은 게임 영역 전체 너비를 사용해야 합니다.').toBeLessThanOrEqual(1);
    expect(Math.abs(panelLayout.itemsWidth - panelLayout.columnWidth), '보유 아이템 패널은 전체 너비여야 합니다.').toBeLessThanOrEqual(1);
    expect(Math.abs(panelLayout.logWidth - panelLayout.columnWidth), '진행 기록 패널은 전체 너비여야 합니다.').toBeLessThanOrEqual(1);
    expect(panelLayout.boardOrder, '윷판은 사이드 패널보다 먼저 배치되어야 합니다.').toBeLessThan(panelLayout.columnOrder);
    expect(panelLayout.boardBottom, '방 정보를 접어도 보유 아이템·진행 기록이 윷판 위로 올라오면 안 됩니다.').toBeLessThanOrEqual(panelLayout.columnTop);
    expect(panelLayout.columnDisplay).toBe('flex');
    expect(panelLayout.columnDirection).toBe('column');
    expect(panelLayout.sameParent, '보유 아이템과 진행 기록은 같은 사이드 열의 별도 패널이어야 합니다.').toBe(true);
    expect(panelLayout.itemsBeforeLog, '보유 아이템 패널은 진행 기록 패널 바로 위에 있어야 합니다.').toBe(true);
    expect(panelLayout.itemsBottom, '두 패널이 겹치면 안 됩니다.').toBeLessThanOrEqual(panelLayout.logTop);

    const initialLayout = await logList.evaluate((element) => {
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

    expect(initialLayout.fourthBottom, '네 번째 진행 기록이 목록 아래에서 잘리면 안 됩니다.').toBeLessThanOrEqual(initialLayout.listBottom + 1);
    expect(initialLayout.scrollHeight, '다섯 번째 기록부터 내부 스크롤이 생겨야 합니다.').toBeGreaterThan(initialLayout.clientHeight);

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
