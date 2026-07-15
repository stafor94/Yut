import { test, expect } from '@playwright/test';

test.describe('아이템전 모바일 사이드 패널', () => {
  test('보유 아이템과 진행 기록을 별도 패널로 배치하고 가장 오래된 기록까지 스크롤한다', async ({ page }) => {
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
      fixture.append(column);
      document.body.append(fixture);
    });

    const fixture = page.locator('#qa-mobile-item-log-fixture');
    const column = fixture.getByTestId('game-side-column');
    const itemsPanel = fixture.getByTestId('owned-items-panel');
    const logList = fixture.getByTestId('game-log-list');
    const logPanel = logList.locator('xpath=ancestor::aside[1]');

    await expect(itemsPanel).toBeVisible();
    await expect(logPanel).toBeVisible();
    await expect(itemsPanel.getByTestId('game-log-list')).toHaveCount(0);
    await expect(logPanel.getByTestId('owned-items-panel')).toHaveCount(0);

    const panelLayout = await column.evaluate((element) => {
      const items = element.querySelector('[data-testid="owned-items-panel"]');
      const list = element.querySelector('[data-testid="game-log-list"]');
      const log = list?.closest('aside');
      if (!(items instanceof HTMLElement) || !(log instanceof HTMLElement)) throw new Error('독립 패널 fixture가 올바르지 않습니다.');
      const itemsBox = items.getBoundingClientRect();
      const logBox = log.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        display: style.display,
        flexDirection: style.flexDirection,
        sameParent: items.parentElement === log.parentElement,
        itemsBeforeLog: items.nextElementSibling === log,
        itemsBottom: itemsBox.bottom,
        logTop: logBox.top,
      };
    });

    expect(panelLayout.display).toBe('flex');
    expect(panelLayout.flexDirection).toBe('column');
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
