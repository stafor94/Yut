import { test, expect } from '@playwright/test';

test.describe('아이템전 모바일 진행 기록', () => {
  test('보유 아이템 아래에서도 네 개 높이를 유지하고 가장 오래된 기록까지 스크롤한다', async ({ page }) => {
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

      const panel = document.createElement('aside');
      panel.className = 'panel side';
      panel.style.width = '100%';
      panel.style.height = '360px';

      const items = document.createElement('div');
      items.className = 'player-items game-log-owned-items';
      items.style.minHeight = '120px';
      items.textContent = '보유 아이템';

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

      panel.append(items, header, list);
      fixture.append(panel);
      document.body.append(fixture);
    });

    const fixture = page.locator('#qa-mobile-item-log-fixture');
    const panel = fixture.locator('.side');
    const logList = fixture.getByTestId('game-log-list');
    await expect(logList).toBeVisible();

    const initialLayout = await logList.evaluate((element) => {
      const panel = element.closest('.side');
      const entries = Array.from(element.querySelectorAll('[data-testid="game-log-entry"]'));
      if (!(panel instanceof HTMLElement) || entries.length < 4) throw new Error('아이템전 진행 기록 fixture가 올바르지 않습니다.');
      const listBox = element.getBoundingClientRect();
      const panelBox = panel.getBoundingClientRect();
      const fourthBox = entries[3].getBoundingClientRect();
      const listStyle = getComputedStyle(element);
      return {
        panelHeight: panelBox.height,
        requestedPanelHeight: Number.parseFloat(panel.style.height),
        listHeight: listBox.height,
        requestedListHeight: Number.parseFloat(element.style.height),
        flexGrow: listStyle.flexGrow,
        flexShrink: listStyle.flexShrink,
        fourthBottom: fourthBox.bottom,
        listBottom: listBox.bottom,
        panelBottom: panelBox.bottom,
        scrollHeight: element.scrollHeight,
        clientHeight: element.clientHeight,
      };
    });

    expect(initialLayout.panelHeight, '아이템 영역 때문에 진행 기록 패널이 고정 높이에 갇히면 안 됩니다.').toBeGreaterThan(initialLayout.requestedPanelHeight);
    expect(initialLayout.listHeight, '진행 기록은 네 개 카드 기준 높이를 유지해야 합니다.').toBeGreaterThanOrEqual(initialLayout.requestedListHeight);
    expect(initialLayout.flexGrow, '아이템전 진행 기록 목록은 남은 높이에 맞춰 강제로 늘어나면 안 됩니다.').toBe('0');
    expect(initialLayout.flexShrink, '아이템전 진행 기록 목록은 한 개 높이로 줄어들면 안 됩니다.').toBe('0');
    expect(initialLayout.fourthBottom, '네 번째 진행 기록이 목록 아래에서 잘리면 안 됩니다.').toBeLessThanOrEqual(initialLayout.listBottom + 1);
    expect(initialLayout.listBottom, '진행 기록 목록 전체가 목재 패널 안에 있어야 합니다.').toBeLessThanOrEqual(initialLayout.panelBottom + 1);
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
    expect(scrolledLayout.scrollTop, '목록이 아래쪽으로 실제 스크롤되어야 합니다.').toBeGreaterThan(0);
    expect(Math.abs(scrolledLayout.scrollTop - scrolledLayout.maxScrollTop), '가장 오래된 기록까지 최대 스크롤되어야 합니다.').toBeLessThanOrEqual(1);
    expect(scrolledLayout.lastTop, '#001 위쪽이 스크롤 영역 밖에 남으면 안 됩니다.').toBeGreaterThanOrEqual(scrolledLayout.visibleTop - 1);
    expect(scrolledLayout.lastBottom, '#001 아래쪽까지 보여야 합니다.').toBeLessThanOrEqual(scrolledLayout.visibleBottom + 1);

    await expect(panel).toBeVisible();
  });
});
