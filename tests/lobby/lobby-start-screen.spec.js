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

  test('로비 팝업은 실시간 목록 안내, 공통 닫기, 설정 저장을 제공한다', async ({ page, context }) => {
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
    await howToDialog.getByRole('button', { name: '확인하고 시작하기' }).click();
    await expect(howToDialog).toBeHidden();

    await page.getByRole('button', { name: '설정', exact: true }).click();
    const settingsDialog = page.getByRole('dialog', { name: '설정' });
    const nicknameInput = settingsDialog.getByLabel('닉네임');
    const saveButton = settingsDialog.getByRole('button', { name: '닉네임 저장' });
    await nicknameInput.fill('가');
    await expect(saveButton).toBeDisabled();
    await nicknameInput.fill('가나다');
    await saveButton.click();
    await expect(settingsDialog).toContainText('닉네임이 저장되었습니다.');
    await expect.poll(() => page.evaluate(() => window.localStorage.getItem('yut-online:nickname'))).toBe('가나다');

    const soundToggle = settingsDialog.getByRole('checkbox', { name: /효과음/ });
    await soundToggle.uncheck();
    await expect.poll(() => page.evaluate(() => window.localStorage.getItem('yut-online:soundEnabled'))).toBe('false');
  });
});
