import { test, expect } from '@playwright/test';

test.describe('모바일 진행 기록 스크롤', () => {
  test('제한된 세로 패널에서도 가장 오래된 기록까지 스크롤할 수 있다', async ({ page }) => {
    await page.goto('/');
    await page.setViewportSize({ width: 390, height: 844 });

    await page.evaluate(() => {
      const fixture = document.createElement('div');
      fixture.id = 'qa-mobile-log-scroll-fixture';
      fixture.className = 'game-shell';
      Object.assign(fixture.style, {
        position: 'fixed', inset: '0', zIndex: '9999', width: '390px', maxWidth: '100vw',
        padding: '12px', background: '#f8f1e4', overflow: 'hidden',
      });

      const panel = document.createElement('aside');
      panel.className = 'panel side';
      panel.style.width = '100%';
      panel.style.height = '360px';

      const header = document.createElement('div');
      header.className = 'log-header';
      const heading = document.createElement('h2');
      heading.textContent = '진행 기록';
      header.append(heading);

      const list = document.createElement('div');
      list.dataset.testid = 'game-log-list';
      list.className = 'log-list scrollable';
      list.style.height = '380px';
      list.style.flex = '0 0 auto';

      ['#005 다섯 번째 진행 기록입니다.', '#004 네 번째 진행 기록입니다.', '#003 세 번째 진행 기록입니다.', '#002 두 번째 진행 기록입니다.', '#001 가장 오래된 첫 번째 진행 기록입니다.'].forEach((text) => {
        const entry = document.createElement('p');
        entry.dataset.testid = 'game-log-entry';
        entry.style.minHeight = '80px';
        entry.textContent = text;
        list.append(entry);
      });

      panel.append(header, list);
      fixture.append(panel);
      document.body.append(fixture);
    });

    const fixture = page.locator('#qa-mobile-log-scroll-fixture');
    const logList = fixture.getByTestId('game-log-list');
    await expect(logList).toBeVisible();

    const initialLayout = await logList.evaluate((element) => {
      const panel = element.closest('.side');
      if (!(panel instanceof HTMLElement)) throw new Error('진행 기록 패널을 찾을 수 없습니다.');
      const listBox = element.getBoundingClientRect();
      const panelBox = panel.getBoundingClientRect();
      const listStyle = getComputedStyle(element);
      const panelStyle = getComputedStyle(panel);
      return {
        flexGrow: listStyle.flexGrow,
        flexShrink: listStyle.flexShrink,
        clientHeight: element.clientHeight,
        requestedHeight: Number.parseFloat(element.style.height),
        scrollHeight: element.scrollHeight,
        listBottom: listBox.bottom,
        panelVisibleBottom: panelBox.bottom - Number.parseFloat(panelStyle.borderBottomWidth),
      };
    });

    expect(initialLayout.flexGrow, '스크롤 목록은 남은 패널 높이를 사용해야 합니다.').toBe('1');
    expect(initialLayout.flexShrink, '패널이 좁으면 스크롤 목록이 실제 노출 높이까지 줄어야 합니다.').toBe('1');
    expect(initialLayout.clientHeight, '계산된 4개 높이가 패널 밖으로 고정되면 안 됩니다.').toBeLessThan(initialLayout.requestedHeight);
    expect(initialLayout.scrollHeight, '5개 이상이면 내부 스크롤이 생겨야 합니다.').toBeGreaterThan(initialLayout.clientHeight);
    expect(initialLayout.listBottom, '스크롤 목록 자체가 목재 패널 아래로 잘리면 안 됩니다.').toBeLessThanOrEqual(initialLayout.panelVisibleBottom + 1);

    await logList.evaluate((element) => new Promise((resolve) => {
      element.scrollTop = element.scrollHeight;
      requestAnimationFrame(() => resolve(undefined));
    }));

    const scrolledLayout = await logList.evaluate((element) => {
      const panel = element.closest('.side');
      const entries = Array.from(element.querySelectorAll('[data-testid="game-log-entry"]'));
      const lastEntry = entries.at(-1);
      if (!(panel instanceof HTMLElement) || !(lastEntry instanceof HTMLElement)) throw new Error('마지막 진행 기록을 찾을 수 없습니다.');
      const listBox = element.getBoundingClientRect();
      const panelBox = panel.getBoundingClientRect();
      const panelStyle = getComputedStyle(panel);
      const lastBox = lastEntry.getBoundingClientRect();
      return {
        scrollTop: element.scrollTop,
        maxScrollTop: element.scrollHeight - element.clientHeight,
        lastTop: lastBox.top,
        lastBottom: lastBox.bottom,
        visibleTop: Math.max(listBox.top, panelBox.top + Number.parseFloat(panelStyle.borderTopWidth)),
        visibleBottom: Math.min(listBox.bottom, panelBox.bottom - Number.parseFloat(panelStyle.borderBottomWidth)),
      };
    });

    expect(scrolledLayout.scrollTop, '목록이 최대 스크롤 위치까지 이동해야 합니다.').toBeGreaterThan(0);
    expect(Math.abs(scrolledLayout.scrollTop - scrolledLayout.maxScrollTop), '최대 스크롤 위치가 실제 스크롤 범위와 일치해야 합니다.').toBeLessThanOrEqual(1);
    expect(scrolledLayout.lastTop, '가장 오래된 기록의 위쪽이 보이는 영역 밖에 남으면 안 됩니다.').toBeGreaterThanOrEqual(scrolledLayout.visibleTop - 1);
    expect(scrolledLayout.lastBottom, '가장 오래된 기록의 아래쪽까지 보여야 합니다.').toBeLessThanOrEqual(scrolledLayout.visibleBottom + 1);
  });
});
