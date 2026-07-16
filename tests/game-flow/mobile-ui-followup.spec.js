import { expect, test } from '@playwright/test';

const qaUrl = process.env.QA_BASE_URL || 'http://127.0.0.1:4173';

test('모바일 인게임 최종 레이아웃 규칙이 실제 요소에 적용된다', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(qaUrl);

  await page.evaluate(() => {
    document.body.innerHTML = `
      <main class="shell game-shell">
        <section class="hero panel game-header-with-end">
          <div class="hero-copy"></div>
          <button data-testid="game-room-info-toggle" class="game-room-header-toggle" aria-expanded="true">▴</button>
          <div class="hero-actions game-actions">
            <button class="nickname-chip">닉네임</button>
            <button class="sound-toggle">켜짐</button>
            <button class="status-card">온라인</button>
          </div>
          <button class="game-end-button">종료</button>
        </section>
        <aside class="game-players-panel">
          <div class="game-player-list">
            <div class="player game-player-card"><span class="game-player-title"><b class="game-player-label">플레이어 1</b></span><em>AI</em></div>
            <div class="player game-player-card"><span class="game-player-title"><b class="game-player-label">플레이어 2</b></span><em>AI</em></div>
            <div class="player game-player-card"><span class="game-player-title"><b class="game-player-label">플레이어 3</b></span><em>유저</em></div>
            <div class="player game-player-card"><span class="game-player-title"><b class="game-player-label">플레이어 4</b></span><em>AI</em></div>
          </div>
        </aside>
        <section class="board-panel">
          <strong class="turn-current" style="--turn-current-color: rgb(58, 120, 194)"><span class="turn-current-badge">플레이어 2</span></strong>
          <span class="route-preview-marker finish">완주</span>
          <span class="finish-complete-label">완주!</span>
        </section>
        <aside class="side"><div class="log-list"><p><span class="log-sequence">#001</span>두 줄로 표시되는 진행 기록입니다.<br>두 번째 줄입니다.</p></div></aside>
      </main>`;
  });

  const header = page.locator('.hero.game-header-with-end');
  const actions = page.locator('.hero-actions.game-actions');
  const toggle = page.getByTestId('game-room-info-toggle');
  const nickname = page.locator('.nickname-chip');
  const sound = page.locator('.sound-toggle');
  const endButton = page.locator('.game-end-button');
  const [headerBox, actionsBox, toggleBox, nicknameBox, soundBox, endBox] = await Promise.all([
    header.boundingBox(),
    actions.boundingBox(),
    toggle.boundingBox(),
    nickname.boundingBox(),
    sound.boundingBox(),
    endButton.boundingBox(),
  ]);
  expect(headerBox).not.toBeNull();
  expect(actionsBox).not.toBeNull();
  expect(toggleBox).not.toBeNull();
  expect(nicknameBox).not.toBeNull();
  expect(soundBox).not.toBeNull();
  expect(endBox).not.toBeNull();
  await expect(actions.locator('.game-room-header-toggle')).toHaveCount(0);
  expect(actionsBox.x).toBeLessThanOrEqual(headerBox.x + 24);
  expect(actionsBox.x + actionsBox.width).toBeLessThanOrEqual(endBox.x - 4);
  expect(Math.abs(nicknameBox.x - actionsBox.x)).toBeLessThanOrEqual(1);
  expect(nicknameBox.width).toBeGreaterThan(soundBox.width + 20);
  expect(toggleBox.x).toBeGreaterThanOrEqual(headerBox.x + 8);
  expect(toggleBox.x).toBeLessThanOrEqual(headerBox.x + 28);
  expect(toggleBox.y).toBeLessThan(headerBox.y + headerBox.height);
  expect(toggleBox.y + toggleBox.height).toBeGreaterThan(headerBox.y + headerBox.height);

  const playerCards = page.locator('.game-player-card');
  const playerBoxes = await Promise.all([0, 1, 2, 3].map((index) => playerCards.nth(index).boundingBox()));
  playerBoxes.forEach((box) => expect(box).not.toBeNull());
  expect(Math.abs(playerBoxes[0].y - playerBoxes[1].y)).toBeLessThanOrEqual(1);
  expect(Math.abs(playerBoxes[2].y - playerBoxes[3].y)).toBeLessThanOrEqual(1);
  expect(playerBoxes[1].x).toBeGreaterThan(playerBoxes[0].x);
  expect(playerBoxes[3].x).toBeGreaterThan(playerBoxes[2].x);
  expect(playerBoxes[2].y).toBeGreaterThan(playerBoxes[0].y);

  const turnBadge = page.locator('.turn-current-badge');
  await expect(turnBadge).toHaveCSS('background-color', 'rgb(58, 120, 194)');
  await expect(turnBadge).toHaveCSS('color', 'rgb(255, 255, 255)');
  await expect(page.locator('.route-preview-marker.finish')).toBeHidden();
  await expect(page.locator('.finish-complete-label')).toBeHidden();

  const sequenceBox = await page.locator('.log-sequence').boundingBox();
  expect(sequenceBox).not.toBeNull();
  expect(sequenceBox.height).toBeLessThanOrEqual(21);
});
