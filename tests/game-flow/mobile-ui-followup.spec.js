import { expect, test } from '@playwright/test';

const qaUrl = process.env.QA_BASE_URL || 'http://127.0.0.1:4173';

test('모바일 인게임 최종 레이아웃 규칙이 실제 요소에 적용된다', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(qaUrl);

  await page.evaluate(() => {
    document.body.innerHTML = `
      <main class="game-shell">
        <section class="hero panel">
          <div class="hero-copy"></div>
          <div class="hero-actions game-actions">
            <button class="game-room-header-toggle">접기</button>
            <button class="nickname-chip">닉네임</button>
            <button class="sound-toggle">켜짐</button>
            <button class="status-card">온라인</button>
          </div>
        </section>
        <aside class="game-players-panel">
          <div class="game-player-list">
            <div class="player game-player-card"><span class="game-player-title"><b class="game-player-label">플레이어 1</b></span><em>AI</em></div>
            <div class="player game-player-card"><span class="game-player-title"><b class="game-player-label">플레이어 2</b></span><em>AI</em></div>
          </div>
        </aside>
        <section class="board-panel">
          <strong class="turn-current" style="--turn-current-color: rgb(58, 120, 194)"><span class="turn-current-badge">플레이어 2</span></strong>
          <span class="route-preview-marker finish">완주</span>
        </section>
        <aside class="side"><div class="log-list"><p><span class="log-sequence">#001</span>두 줄로 표시되는 진행 기록입니다.<br>두 번째 줄입니다.</p></div></aside>
      </main>`;
  });

  const header = page.locator('.hero');
  const actions = page.locator('.hero-actions.game-actions');
  const toggle = page.locator('.game-room-header-toggle');
  const nickname = page.locator('.nickname-chip');
  const [headerBox, actionsBox, toggleBox, nicknameBox] = await Promise.all([
    header.boundingBox(),
    actions.boundingBox(),
    toggle.boundingBox(),
    nickname.boundingBox(),
  ]);
  expect(headerBox).not.toBeNull();
  expect(actionsBox).not.toBeNull();
  expect(toggleBox).not.toBeNull();
  expect(nicknameBox).not.toBeNull();
  expect(actionsBox.x).toBeLessThanOrEqual(headerBox.x + 24);
  expect(actionsBox.x + actionsBox.width).toBeGreaterThanOrEqual(headerBox.x + headerBox.width - 24);
  expect(nicknameBox.x - (toggleBox.x + toggleBox.width)).toBeGreaterThanOrEqual(20);

  const playerCards = page.locator('.game-player-card');
  const firstPlayerBox = await playerCards.nth(0).boundingBox();
  const secondPlayerBox = await playerCards.nth(1).boundingBox();
  expect(firstPlayerBox).not.toBeNull();
  expect(secondPlayerBox).not.toBeNull();
  expect(Math.abs(firstPlayerBox.y - secondPlayerBox.y)).toBeLessThanOrEqual(1);
  expect(secondPlayerBox.x).toBeGreaterThan(firstPlayerBox.x);

  const turnBadge = page.locator('.turn-current-badge');
  await expect(turnBadge).toHaveCSS('background-color', 'rgb(58, 120, 194)');
  await expect(turnBadge).toHaveCSS('color', 'rgb(255, 255, 255)');
  await expect(page.locator('.route-preview-marker.finish')).toBeHidden();

  const sequenceBox = await page.locator('.log-sequence').boundingBox();
  expect(sequenceBox).not.toBeNull();
  expect(sequenceBox.height).toBeLessThanOrEqual(21);
});
