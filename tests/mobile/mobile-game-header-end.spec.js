import { test, expect } from '@playwright/test';

test.describe('모바일 인게임 헤더 종료 버튼', () => {
  test('온라인 표시 우측에 빨간 종료 버튼을 겹침 없이 배치한다', async ({ page }) => {
    await page.goto('/');
    await page.setViewportSize({ width: 390, height: 844 });

    await page.evaluate(() => {
      const fixture = document.createElement('div');
      fixture.id = 'qa-mobile-game-header-fixture';
      fixture.className = 'game-shell';
      Object.assign(fixture.style, {
        position: 'fixed', inset: '0 auto auto 0', zIndex: '9999', width: '390px',
        padding: '12px', background: '#f8f1e4',
      });

      const header = document.createElement('section');
      header.className = 'hero panel game-header-with-end';
      const copy = document.createElement('div');
      copy.className = 'hero-copy';
      const actions = document.createElement('div');
      actions.className = 'hero-actions game-actions';

      const roomToggle = document.createElement('button');
      roomToggle.className = 'game-room-header-toggle';
      roomToggle.textContent = '▴';
      const nickname = document.createElement('button');
      nickname.className = 'nickname-chip';
      nickname.textContent = '닉네임';
      const sound = document.createElement('button');
      sound.className = 'sound-controls sound-toggle active';
      sound.textContent = '켜짐';
      const status = document.createElement('button');
      status.className = 'status-card';
      status.dataset.testid = 'server-status';
      status.textContent = '온라인';
      actions.append(roomToggle, nickname, sound, status);

      const endButton = document.createElement('button');
      endButton.dataset.testid = 'game-end-button';
      endButton.className = 'game-end-button';
      endButton.textContent = '종료';
      endButton.addEventListener('click', () => {
        fixture.dataset.endRequested = 'true';
      });

      header.append(copy, actions, endButton);
      fixture.append(header);
      document.body.append(fixture);
    });

    const fixture = page.locator('#qa-mobile-game-header-fixture');
    const header = fixture.locator('.hero');
    const actions = fixture.locator('.hero-actions');
    const status = fixture.getByTestId('server-status');
    const endButton = fixture.getByTestId('game-end-button');

    await expect(endButton).toBeVisible();
    await expect(endButton).toHaveText('종료');
    await expect(actions.locator('button')).toHaveCount(4);

    const layout = await header.evaluate((element) => {
      const status = element.querySelector('[data-testid="server-status"]');
      const end = element.querySelector('[data-testid="game-end-button"]');
      if (!(status instanceof HTMLElement) || !(end instanceof HTMLElement)) throw new Error('헤더 종료 버튼 fixture가 올바르지 않습니다.');
      const headerBox = element.getBoundingClientRect();
      const statusBox = status.getBoundingClientRect();
      const endBox = end.getBoundingClientRect();
      const endStyle = getComputedStyle(end);
      return {
        headerLeft: headerBox.left,
        headerRight: headerBox.right,
        statusRight: statusBox.right,
        endLeft: endBox.left,
        endRight: endBox.right,
        backgroundImage: endStyle.backgroundImage,
        color: endStyle.color,
      };
    });

    expect(layout.statusRight, '종료 버튼은 온라인 표시 오른쪽에 있어야 합니다.').toBeLessThanOrEqual(layout.endLeft);
    expect(layout.endLeft, '종료 버튼이 헤더 왼쪽 밖으로 나가면 안 됩니다.').toBeGreaterThanOrEqual(layout.headerLeft);
    expect(layout.endRight, '종료 버튼이 헤더 오른쪽 밖으로 나가면 안 됩니다.').toBeLessThanOrEqual(layout.headerRight);
    expect(layout.backgroundImage, '종료 버튼은 빨간 입체 배경을 사용해야 합니다.').toContain('linear-gradient');
    expect(layout.color).not.toBe('rgb(42, 30, 23)');

    await endButton.click();
    await expect(fixture).toHaveAttribute('data-end-requested', 'true');
  });
});
