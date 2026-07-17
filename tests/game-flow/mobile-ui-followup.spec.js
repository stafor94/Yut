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
          <button data-testid="collapsed-room-info-toggle" class="game-room-info-toggle game-room-info-toggle-collapsed" aria-expanded="false"><span class="game-room-info-toggle-direction">▼</span><span>펼치기</span></button>
          <div class="hero-actions game-actions">
            <button class="nickname-chip">닉네임</button>
            <button class="sound-toggle">켜짐</button>
            <button class="status-card">온라인</button>
          </div>
          <button class="game-end-button">종료</button>
        </section>
        <aside class="panel players game-players-panel">
          <div class="game-player-list">
            <div class="player game-player-card"><span class="game-player-title"><b class="game-player-label">플레이어 1</b></span><em>AI</em></div>
            <div class="player game-player-card"><span class="game-player-title"><b class="game-player-label">플레이어 2</b></span><em>AI</em></div>
            <div class="player game-player-card"><span class="game-player-title"><b class="game-player-label">플레이어 3</b></span><em>유저</em></div>
            <div class="player game-player-card"><span class="game-player-title"><b class="game-player-label">플레이어 4</b></span><em>AI</em></div>
          </div>
          <button data-testid="expanded-room-info-toggle" class="game-room-info-toggle game-room-info-toggle-expanded" aria-expanded="true"><span class="game-room-info-toggle-direction">▲</span><span>접기</span></button>
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
  const collapsedToggle = page.getByTestId('collapsed-room-info-toggle');
  const expandedToggle = page.getByTestId('expanded-room-info-toggle');
  const playersPanel = page.locator('.game-players-panel');
  const nickname = page.locator('.nickname-chip');
  const sound = page.locator('.sound-toggle');
  const endButton = page.locator('.game-end-button');
  const [headerBox, actionsBox, collapsedToggleBox, playersPanelBox, expandedToggleBox, nicknameBox, soundBox, endBox] = await Promise.all([
    header.boundingBox(),
    actions.boundingBox(),
    collapsedToggle.boundingBox(),
    playersPanel.boundingBox(),
    expandedToggle.boundingBox(),
    nickname.boundingBox(),
    sound.boundingBox(),
    endButton.boundingBox(),
  ]);
  expect(headerBox).not.toBeNull();
  expect(actionsBox).not.toBeNull();
  expect(collapsedToggleBox).not.toBeNull();
  expect(playersPanelBox).not.toBeNull();
  expect(expandedToggleBox).not.toBeNull();
  expect(nicknameBox).not.toBeNull();
  expect(soundBox).not.toBeNull();
  expect(endBox).not.toBeNull();
  await expect(actions.locator('.game-room-info-toggle')).toHaveCount(0);
  expect(actionsBox.x).toBeLessThanOrEqual(headerBox.x + 24);
  expect(actionsBox.x + actionsBox.width).toBeLessThanOrEqual(endBox.x - 4);
  expect(Math.abs(nicknameBox.x - actionsBox.x)).toBeLessThanOrEqual(1);
  expect(nicknameBox.width).toBeGreaterThan(soundBox.width + 20);

  const headerCenter = headerBox.x + headerBox.width / 2;
  const collapsedToggleCenter = collapsedToggleBox.x + collapsedToggleBox.width / 2;
  expect(Math.abs(collapsedToggleCenter - headerCenter)).toBeLessThanOrEqual(1);
  expect(collapsedToggleBox.y).toBeLessThan(headerBox.y + headerBox.height);
  expect(collapsedToggleBox.y + collapsedToggleBox.height).toBeGreaterThan(headerBox.y + headerBox.height);
  await expect(collapsedToggle).toHaveText('▼펼치기');
  await expect(collapsedToggle).toHaveCSS('color', 'rgb(79, 45, 25)');
  await expect(collapsedToggle).toHaveCSS('border-top-color', 'rgb(141, 90, 45)');

  const playersPanelCenter = playersPanelBox.x + playersPanelBox.width / 2;
  const expandedToggleCenter = expandedToggleBox.x + expandedToggleBox.width / 2;
  expect(Math.abs(expandedToggleCenter - playersPanelCenter)).toBeLessThanOrEqual(1);
  expect(expandedToggleBox.y).toBeLessThan(playersPanelBox.y + playersPanelBox.height);
  expect(expandedToggleBox.y + expandedToggleBox.height).toBeGreaterThan(playersPanelBox.y + playersPanelBox.height);
  await expect(expandedToggle).toHaveText('▲접기');

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
