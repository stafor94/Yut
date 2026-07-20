import { test, expect } from '@playwright/test';
import { expectAppShell, primeLobbyStorage, waitForBlockingOverlayToDisappear } from '../helpers/ui.js';

test.describe('lobby start screen QA', () => {
  test('최초 사용자는 유효한 닉네임을 저장해야 로비 기능을 사용할 수 있다', async ({ page, context }) => {
    await context.addInitScript(() => {
      window.localStorage.removeItem('yut-online:nickname');
    });

    await expectAppShell(page);
    const nicknameDialog = page.getByRole('dialog', { name: '닉네임 설정' });
    await expect(nicknameDialog).toBeVisible();

    const nicknameInput = nicknameDialog.getByPlaceholder('닉네임');
    const startButton = nicknameDialog.getByRole('button', { name: '시작하기' });
    await expect(nicknameInput).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(nicknameInput).toBeFocused();

    await nicknameInput.fill('가');
    await expect(startButton).toBeDisabled();
    await nicknameInput.fill('가나');
    await expect(startButton).toBeEnabled();
    await page.keyboard.press('Tab');
    await expect(startButton).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(nicknameInput).toBeFocused();
    await startButton.click();

    await expect(nicknameDialog).toBeHidden();
    await expect.poll(() => page.evaluate(() => window.localStorage.getItem('yut-online:nickname'))).toBe('가나');
    await expect(page.getByRole('button', { name: '방 만들기', exact: true })).toBeEnabled();
    await expect(page.getByRole('button', { name: '게임 참가', exact: true })).toBeEnabled();
  });

  test('로비는 브랜드, 윷판 장면, 네 개의 윷가락과 계층화된 시작 액션을 제공한다', async ({ page, context }) => {
    await primeLobbyStorage(context, { nickname: '로비QA' });
    await expectAppShell(page);
    await waitForBlockingOverlayToDisappear(page);

    const lobby = page.getByTestId('lobby-screen');
    const heroArt = lobby.getByTestId('lobby-hero-art');
    const createButton = lobby.getByRole('button', { name: '방 만들기', exact: true });
    const joinButton = lobby.getByRole('button', { name: '게임 참가', exact: true });

    await expect(lobby.getByRole('heading', { name: '윷놀이', exact: true })).toBeVisible();
    await expect(lobby).toContainText('친구들과 바로 즐기는');
    await expect(heroArt).toBeVisible();
    await expect(heroArt.locator('[data-testid^="lobby-yut-stick-"]')).toHaveCount(4);
    await expect(createButton).toContainText('방 만들기');
    await expect(joinButton).toContainText('방 코드로 참가');
    await expect(lobby.getByRole('button', { name: '게임 방법', exact: true })).toBeVisible();
    await expect(lobby.getByRole('button', { name: '설정', exact: true })).toBeVisible();

    const layout = await lobby.evaluate((element) => {
      const rect = (target) => {
        const box = target.getBoundingClientRect();
        return { x: box.x, y: box.y, width: box.width, height: box.height, bottom: box.bottom, right: box.right };
      };
      const art = element.querySelector('[data-testid="lobby-hero-art"]');
      const create = element.querySelector('[aria-label="방 만들기"]');
      const join = element.querySelector('[aria-label="게임 참가"]');
      if (!(art instanceof HTMLElement) || !(create instanceof HTMLElement) || !(join instanceof HTMLElement)) return null;
      return {
        viewportWidth: window.innerWidth,
        documentScrollWidth: document.documentElement.scrollWidth,
        art: rect(art),
        create: rect(create),
        join: rect(join),
      };
    });

    expect(layout, '로비 핵심 장면과 CTA 레이아웃을 읽을 수 있어야 합니다.').not.toBeNull();
    expect(layout.documentScrollWidth, '로비가 가로 스크롤을 만들면 안 됩니다.').toBeLessThanOrEqual(layout.viewportWidth);
    expect(layout.art.x, '윷판 장면 왼쪽이 화면 밖으로 나가면 안 됩니다.').toBeGreaterThanOrEqual(0);
    expect(layout.art.right, '윷판 장면 오른쪽이 화면 밖으로 나가면 안 됩니다.').toBeLessThanOrEqual(layout.viewportWidth);
    expect(layout.art.height, '윷판 장면은 단순 아이콘이 아닌 충분한 시각 면적을 가져야 합니다.').toBeGreaterThan(180);
    expect(layout.create.height, '주 CTA는 충분한 터치 면적을 가져야 합니다.').toBeGreaterThanOrEqual(64);
    expect(layout.join.height, '참가 CTA는 충분한 터치 면적을 가져야 합니다.').toBeGreaterThanOrEqual(64);
    expect(layout.join.y, '방 참가 CTA는 방 만들기 CTA 아래에 배치되어야 합니다.').toBeGreaterThan(layout.create.y);
  });

  test('세로 모바일 로비는 스크롤 없이 전체 시작 UI와 한 줄 상태 바를 보여준다', async ({ page, context }) => {
    await page.setViewportSize({ width: 390, height: 780 });
    await primeLobbyStorage(context, { nickname: '세로모드QA' });
    await expectAppShell(page);
    await waitForBlockingOverlayToDisappear(page);

    const nicknameDisplay = page.getByTestId('lobby-nickname-display');
    const soundButton = page.getByRole('button', { name: /효과음/ });
    const statusButton = page.getByRole('button', { name: /서버 상태:/ });
    const settingsButton = page.getByRole('button', { name: '설정', exact: true });
    await expect(nicknameDisplay).toBeVisible();
    await expect(soundButton).toBeVisible();
    await expect(statusButton).toBeVisible();
    await expect(settingsButton).toBeVisible();

    const layout = await page.evaluate(() => {
      const shell = document.querySelector('[data-testid="app-shell"]');
      const secondary = document.querySelector('.lobby-secondary-actions');
      const utilities = Array.from(document.querySelectorAll('.screen-lobby > .hero.panel .hero-actions > button'));
      if (!(shell instanceof HTMLElement) || !(secondary instanceof HTMLElement) || utilities.length !== 3) return null;
      const utilityRects = utilities.map((element) => element.getBoundingClientRect());
      const shellRect = shell.getBoundingClientRect();
      const secondaryRect = secondary.getBoundingClientRect();
      return {
        viewportHeight: window.innerHeight,
        scrollHeight: document.documentElement.scrollHeight,
        scrollY: window.scrollY,
        shellBottom: shellRect.bottom,
        secondaryBottom: secondaryRect.bottom,
        utilityTopSpread: Math.max(...utilityRects.map((rect) => rect.top)) - Math.min(...utilityRects.map((rect) => rect.top)),
        utilityMaxHeight: Math.max(...utilityRects.map((rect) => rect.height)),
      };
    });

    expect(layout, '세로 로비 레이아웃을 읽을 수 있어야 합니다.').not.toBeNull();
    expect(layout.scrollY, '세로 로비는 초기 스크롤 위치가 상단이어야 합니다.').toBe(0);
    expect(layout.scrollHeight, '세로 로비는 문서 스크롤을 만들면 안 됩니다.').toBeLessThanOrEqual(layout.viewportHeight + 1);
    expect(layout.shellBottom, '앱 셸은 세로 뷰포트 안에서 끝나야 합니다.').toBeLessThanOrEqual(layout.viewportHeight + 1);
    expect(layout.secondaryBottom, '게임 방법과 설정까지 스크롤 없이 보여야 합니다.').toBeLessThanOrEqual(layout.viewportHeight + 1);
    expect(layout.utilityTopSpread, '닉네임·효과음·온라인 상태는 한 줄에 있어야 합니다.').toBeLessThanOrEqual(1);
    expect(layout.utilityMaxHeight, '상단 상태 바는 작은 높이를 유지해야 합니다.').toBeLessThanOrEqual(34);

    await nicknameDisplay.click();
    const settingsDialog = page.getByRole('dialog', { name: '설정' });
    await expect(settingsDialog).toBeVisible();
    await expect(page.getByRole('dialog', { name: '닉네임 설정' })).toHaveCount(0);
    await expect(settingsDialog.getByRole('textbox', { name: '닉네임', exact: true })).toBeVisible();
    await settingsDialog.getByRole('button', { name: '취소' }).click();
    await expect(settingsDialog).toBeHidden();
  });

  test('유효하지 않은 닉네임이면 저장된 방 ID가 있어도 자동 복구하지 않는다', async ({ page, context }) => {
    await context.addInitScript(() => {
      window.localStorage.setItem('yut-online:nickname', '가');
      window.localStorage.setItem('yut-online:activeRoomId', 'invalid-nickname-recovery-target');
    });

    await expectAppShell(page);
    await expect(page.getByRole('dialog', { name: '닉네임 설정' })).toBeVisible();
    await expect(page.getByRole('button', { name: /서버 상태: 온라인/ })).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(500);
    await expect(page.locator('.loading-modal-backdrop')).toBeHidden();
    await expect.poll(() => page.evaluate(() => window.localStorage.getItem('yut-online:activeRoomId'))).toBe('invalid-nickname-recovery-target');
  });

  test('로비 팝업은 실시간 목록 안내, 고품질 게임 방법, 통합 설정 저장을 제공한다', async ({ page, context }) => {
    await primeLobbyStorage(context, { nickname: '가나' });
    await expectAppShell(page);
    await waitForBlockingOverlayToDisappear(page);

    const joinTrigger = page.getByRole('button', { name: '게임 참가', exact: true });
    await joinTrigger.click();
    const joinDialog = page.getByRole('dialog', { name: '게임 참가' });
    await expect(joinDialog).toBeVisible();
    await expect(joinDialog).toContainText('실시간 자동 갱신');
    await page.keyboard.press('Escape');
    await expect(joinDialog).toBeHidden();
    await expect(joinTrigger).toBeFocused();

    await page.getByRole('button', { name: '게임 방법', exact: true }).click();
    const howToDialog = page.getByRole('dialog', { name: '게임 방법' });
    await expect(howToDialog).toBeVisible();
    await expect(howToDialog).toContainText('재접속과 관전');
    await expect(howToDialog.locator('.howto-list article')).toHaveCount(4);
    await expect(howToDialog.locator('.howto-result-strip span')).toHaveCount(5);
    const howToSurface = await howToDialog.locator('.howto-list article').first().evaluate((element) => {
      const style = getComputedStyle(element);
      return { backgroundImage: style.backgroundImage, borderRadius: Number.parseFloat(style.borderRadius), boxShadow: style.boxShadow };
    });
    expect(howToSurface.backgroundImage, '게임 방법 카드는 입체 그라데이션 표면이어야 합니다.').toContain('gradient');
    expect(howToSurface.borderRadius, '게임 방법 카드는 충분히 다듬어진 모서리를 사용해야 합니다.').toBeGreaterThanOrEqual(15);
    expect(howToSurface.boxShadow, '게임 방법 카드는 깊이감을 가져야 합니다.').not.toBe('none');
    await howToDialog.getByRole('button', { name: '확인하고 시작하기' }).click();
    await expect(howToDialog).toBeHidden();

    await page.getByRole('button', { name: '설정', exact: true }).click();
    const settingsDialog = page.getByRole('dialog', { name: '설정' });
    await expect(settingsDialog.locator('.settings-card')).toHaveCount(2);
    const nicknameInput = settingsDialog.getByRole('textbox', { name: '닉네임', exact: true });
    const saveButton = settingsDialog.getByRole('button', { name: '닉네임 저장', exact: true });
    await nicknameInput.fill('가');
    await expect(saveButton).toBeDisabled();
    await nicknameInput.fill('가나다');
    await saveButton.click();
    await expect(settingsDialog).toContainText('닉네임이 저장되었습니다.');
    await expect.poll(() => page.evaluate(() => window.localStorage.getItem('yut-online:nickname'))).toBe('가나다');

    const soundSwitch = settingsDialog.locator('.lobby-sound-switch');
    const soundToggle = soundSwitch.getByRole('checkbox', { name: /게임 효과음/ });
    await expect(soundToggle).toBeChecked();
    await soundSwitch.locator('.sound-switch-track').click();
    await expect(soundToggle).not.toBeChecked();
    await expect.poll(() => page.evaluate(() => window.localStorage.getItem('yut-online:soundEnabled'))).toBe('false');
  });
});
