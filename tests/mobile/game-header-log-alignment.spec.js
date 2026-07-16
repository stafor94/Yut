import { test, expect } from '@playwright/test';
import { expectAppShell } from '../helpers/ui.js';

test.describe('모바일 인게임 정렬', () => {
  test('접기 탭과 방 옵션 및 상단 버튼을 지정 위치에 정렬한다', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await expectAppShell(page);

    await page.evaluate(() => {
      const fixture = document.createElement('main');
      fixture.id = 'qa-game-alignment-fixture';
      fixture.className = 'game-shell';
      Object.assign(fixture.style, {
        position: 'fixed',
        inset: '0 auto auto 0',
        zIndex: '9999',
        width: '390px',
        padding: '12px',
        background: '#f8f1e4',
      });

      const header = document.createElement('section');
      header.className = 'hero panel game-header-with-end';
      const toggle = document.createElement('button');
      toggle.className = 'game-room-header-toggle';
      toggle.dataset.testid = 'game-room-info-toggle';
      toggle.setAttribute('aria-expanded', 'true');
      const toggleIcon = document.createElement('span');
      toggleIcon.className = 'game-room-header-toggle-icon';
      toggleIcon.textContent = '▴';
      toggle.append(toggleIcon);

      const actions = document.createElement('div');
      actions.className = 'hero-actions game-actions';
      [
        ['nickname-chip', '닉네임'],
        ['sound-controls sound-toggle active', '켜짐'],
        ['status-card online', '온라인'],
      ].forEach(([className, text]) => {
        const button = document.createElement('button');
        button.className = className;
        button.textContent = text;
        actions.append(button);
      });
      const endButton = document.createElement('button');
      endButton.className = 'game-end-button';
      endButton.textContent = '종료';
      header.append(toggle, actions, endButton);

      const playersPanel = document.createElement('section');
      playersPanel.className = 'game-players-panel';
      const details = document.createElement('div');
      details.className = 'game-room-details';
      const title = document.createElement('h2');
      title.className = 'game-room-title';
      title.textContent = '테스트 방';
      const badges = document.createElement('p');
      badges.className = 'game-end-guide room-rule-badges game-room-rule-badges';
      ['개인전', '3인', '말 4개', '아이템전', '누적'].forEach((label) => {
        const badge = document.createElement('span');
        badge.className = 'room-rule-badge neutral';
        badge.textContent = label;
        badges.append(badge);
      });
      const playerList = document.createElement('div');
      playerList.className = 'game-player-list';
      playerList.textContent = '플레이어 목록';
      details.append(title, badges, playerList);
      playersPanel.append(details);

      const side = document.createElement('aside');
      side.className = 'panel side';
      const logList = document.createElement('div');
      logList.className = 'log-list scrollable';
      const logEntry = document.createElement('p');
      const sequence = document.createElement('span');
      sequence.className = 'log-sequence';
      sequence.textContent = '#001';
      const logText = document.createElement('span');
      logText.dataset.testid = 'log-text';
      logText.textContent = '첫 번째 진행 기록';
      logEntry.append(sequence, logText);
      logList.append(logEntry);
      side.append(logList);

      fixture.append(header, playersPanel, side);
      document.body.append(fixture);
    });

    const fixture = page.locator('#qa-game-alignment-fixture');
    const header = fixture.locator('.hero.game-header-with-end');
    const actions = header.locator('.hero-actions.game-actions');
    const toggle = header.getByTestId('game-room-info-toggle');
    const headerButtons = actions.locator(':scope > button');
    const endButton = header.locator(':scope > .game-end-button');
    const buttonHeights = await headerButtons.evaluateAll((buttons) => buttons.map((button) => button.getBoundingClientRect().height));
    const endHeight = await endButton.evaluate((button) => button.getBoundingClientRect().height);
    expect(buttonHeights.length).toBe(3);
    buttonHeights.forEach((height) => expect(Math.abs(height - endHeight)).toBeLessThanOrEqual(1));

    const headerLayout = await header.evaluate((element) => {
      const actionsElement = element.querySelector('.hero-actions.game-actions');
      const toggleElement = element.querySelector('.game-room-header-toggle');
      const toggleIconElement = element.querySelector('.game-room-header-toggle-icon');
      const nickname = element.querySelector('.nickname-chip');
      const sound = element.querySelector('.sound-toggle');
      const end = element.querySelector('.game-end-button');
      if (!(actionsElement instanceof HTMLElement) || !(toggleElement instanceof HTMLElement) || !(toggleIconElement instanceof HTMLElement) || !(nickname instanceof HTMLElement) || !(sound instanceof HTMLElement) || !(end instanceof HTMLElement)) {
        throw new Error('상단 헤더 fixture가 올바르지 않습니다.');
      }
      const headerBox = element.getBoundingClientRect();
      const actionsBox = actionsElement.getBoundingClientRect();
      const toggleBox = toggleElement.getBoundingClientRect();
      const nicknameBox = nickname.getBoundingClientRect();
      const soundBox = sound.getBoundingClientRect();
      const endBox = end.getBoundingClientRect();
      const toggleStyle = getComputedStyle(toggleElement);
      const toggleIconStyle = getComputedStyle(toggleIconElement);
      return {
        headerLeft: headerBox.left,
        headerBottom: headerBox.bottom,
        actionsLeft: actionsBox.left,
        actionsRight: actionsBox.right,
        toggleLeft: toggleBox.left,
        toggleTop: toggleBox.top,
        toggleBottom: toggleBox.bottom,
        toggleWidth: toggleBox.width,
        toggleHeight: toggleBox.height,
        toggleFontSize: Number.parseFloat(toggleStyle.fontSize),
        toggleIconFontSize: Number.parseFloat(toggleIconStyle.fontSize),
        nicknameLeft: nicknameBox.left,
        nicknameWidth: nicknameBox.width,
        soundWidth: soundBox.width,
        endLeft: endBox.left,
        toggleInsideActions: actionsElement.contains(toggleElement),
      };
    });
    expect(headerLayout.toggleInsideActions).toBe(false);
    expect(headerLayout.toggleLeft).toBeGreaterThanOrEqual(headerLayout.headerLeft + 8);
    expect(headerLayout.toggleLeft).toBeLessThanOrEqual(headerLayout.headerLeft + 28);
    expect(headerLayout.toggleTop, '접기 탭의 위쪽은 헤더 안쪽에 걸쳐야 합니다.').toBeLessThan(headerLayout.headerBottom);
    expect(headerLayout.toggleBottom, '접기 탭의 아래쪽은 헤더 테두리 밖으로 돌출되어야 합니다.').toBeGreaterThan(headerLayout.headerBottom);
    expect(headerLayout.toggleWidth, '모바일 접기 탭 폭은 유지되어야 합니다.').toBe(44);
    expect(headerLayout.toggleHeight, '모바일 접기 탭 높이는 유지되어야 합니다.').toBe(30);
    expect(Math.abs(headerLayout.toggleIconFontSize - headerLayout.toggleFontSize - 6), '접기/펼치기 아이콘 글자는 버튼 글자보다 6px 커야 합니다.').toBeLessThanOrEqual(.1);
    expect(Math.abs(headerLayout.nicknameLeft - headerLayout.actionsLeft)).toBeLessThanOrEqual(1);
    expect(headerLayout.actionsRight).toBeLessThanOrEqual(headerLayout.endLeft - 4);
    expect(headerLayout.nicknameWidth, '닉네임 버튼은 접기 버튼이 빠진 공간을 사용해야 합니다.').toBeGreaterThan(headerLayout.soundWidth + 20);

    const roomLayout = await fixture.locator('.game-room-details').evaluate((details) => {
      const title = details.querySelector('.game-room-title');
      const badges = details.querySelector('.game-room-rule-badges');
      const playerList = details.querySelector('.game-player-list');
      if (!(title instanceof HTMLElement) || !(badges instanceof HTMLElement) || !(playerList instanceof HTMLElement)) throw new Error('방 정보 fixture가 올바르지 않습니다.');
      const titleBox = title.getBoundingClientRect();
      const badgesBox = badges.getBoundingClientRect();
      const playerBox = playerList.getBoundingClientRect();
      return {
        titleTop: titleBox.top,
        titleRight: titleBox.right,
        badgesTop: badgesBox.top,
        badgesRight: badgesBox.right,
        playerTop: playerBox.top,
      };
    });
    expect(Math.abs(roomLayout.titleTop - roomLayout.badgesTop)).toBeLessThanOrEqual(8);
    expect(roomLayout.badgesRight).toBeGreaterThan(roomLayout.titleRight);
    expect(roomLayout.playerTop).toBeGreaterThan(roomLayout.badgesTop);

    const logLayout = await fixture.locator('.log-list p').evaluate((entry) => {
      const list = entry.parentElement;
      const sequence = entry.querySelector('.log-sequence');
      const text = entry.querySelector('[data-testid="log-text"]');
      if (!(list instanceof HTMLElement) || !(sequence instanceof HTMLElement) || !(text instanceof HTMLElement)) throw new Error('진행 기록 fixture가 올바르지 않습니다.');
      const listBox = list.getBoundingClientRect();
      const entryBox = entry.getBoundingClientRect();
      const sequenceBox = sequence.getBoundingClientRect();
      const textBox = text.getBoundingClientRect();
      const entryStyle = getComputedStyle(entry);
      const sequenceStyle = getComputedStyle(sequence);
      return {
        entryPaddingLeft: Number.parseFloat(entryStyle.paddingLeft),
        sequenceTop: sequenceStyle.top,
        sequenceLeft: sequenceStyle.left,
        sequenceTopOffset: sequenceBox.top - entryBox.top,
        sequenceLeftOffset: sequenceBox.left - entryBox.left,
        sequenceTopInsideList: sequenceBox.top - listBox.top,
        sequenceLeftInsideList: sequenceBox.left - listBox.left,
        sequenceRight: sequenceBox.right,
        textLeft: textBox.left,
        textGap: textBox.left - sequenceBox.right,
      };
    });
    expect(logLayout.entryPaddingLeft, '진행 기록 메시지 왼쪽 여백은 축소된 값이어야 합니다.').toBe(42);
    expect(logLayout.sequenceTop).toBe('-12px');
    expect(logLayout.sequenceLeft).toBe('-12px');
    expect(logLayout.sequenceTopOffset, '번호 배지는 카드 상단보다 위로 돌출되어야 합니다.').toBeLessThan(0);
    expect(logLayout.sequenceLeftOffset, '번호 배지는 카드 왼쪽보다 밖으로 돌출되어야 합니다.').toBeLessThan(0);
    expect(logLayout.sequenceTopInsideList, '상단으로 돌출된 번호 배지가 스크롤 영역에 잘리면 안 됩니다.').toBeGreaterThanOrEqual(0);
    expect(logLayout.sequenceLeftInsideList, '왼쪽으로 돌출된 번호 배지가 스크롤 영역에 잘리면 안 됩니다.').toBeGreaterThanOrEqual(0);
    expect(logLayout.textLeft).toBeGreaterThan(logLayout.sequenceRight);
    expect(logLayout.textGap, '번호 배지와 메시지 사이 간격은 과도하게 넓으면 안 됩니다.').toBeLessThanOrEqual(16);
  });
});
