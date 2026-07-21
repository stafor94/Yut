import { test, expect } from '@playwright/test';
import { expectAppShell, primeLobbyStorage, runQaStep, waitForBlockingOverlayToDisappear } from '../helpers/ui.js';

test.describe('mobile lobby polish QA', () => {
  test('첨부 배경 위에 상단 배지와 시작 액션을 한 화면으로 배치한다', async ({ page, context }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 780 });
    await primeLobbyStorage(context, { nickname: '모바일로비QA' });

    await runQaStep(testInfo, '모바일 로비 배경·배지·액션 배치 확인', async () => {
      await expectAppShell(page);
      await waitForBlockingOverlayToDisappear(page);

      const layout = await page.evaluate(() => {
        const shell = document.querySelector('.screen-lobby.lobby-shell');
        const stage = document.querySelector('.lobby-stage');
        const scene = document.querySelector('.lobby-scene');
        const primary = document.querySelector('.lobby-primary-actions');
        const create = document.querySelector('[aria-label="방 만들기"]');
        const join = document.querySelector('[aria-label="게임 참가"]');
        const sound = document.querySelector('.screen-lobby > .hero.panel .sound-toggle');
        const status = document.querySelector('.screen-lobby > .hero.panel .status-card');
        const secondary = document.querySelector('.lobby-secondary-actions');
        const secondaryButtons = Array.from(document.querySelectorAll('.lobby-secondary-actions button'));
        if (!(shell instanceof HTMLElement) || !(stage instanceof HTMLElement) || !(scene instanceof HTMLElement) || !(primary instanceof HTMLElement) || !(create instanceof HTMLElement) || !(join instanceof HTMLElement) || !(sound instanceof HTMLElement) || !(status instanceof HTMLElement) || !(secondary instanceof HTMLElement) || secondaryButtons.length !== 2) return null;
        const rect = (element) => {
          const box = element.getBoundingClientRect();
          return { x: box.x, y: box.y, width: box.width, height: box.height, right: box.right, bottom: box.bottom };
        };
        const shellStyle = getComputedStyle(shell);
        const stageStyle = getComputedStyle(stage);
        const sceneStyle = getComputedStyle(scene);
        const createStyle = getComputedStyle(create);
        const joinStyle = getComputedStyle(join);
        const secondaryStyle = getComputedStyle(secondary);
        const copyrightStyle = getComputedStyle(secondary, '::after');
        return {
          viewportWidth: window.innerWidth,
          viewportHeight: window.innerHeight,
          documentClientWidth: document.documentElement.clientWidth,
          documentScrollWidth: document.documentElement.scrollWidth,
          scrollHeight: document.documentElement.scrollHeight,
          bodyOverflow: getComputedStyle(document.body).overflow,
          htmlOverflow: getComputedStyle(document.documentElement).overflow,
          rootOverflow: getComputedStyle(document.getElementById('root')).overflow,
          stage: rect(stage),
          scene: rect(scene),
          primary: rect(primary),
          create: rect(create),
          join: rect(join),
          secondary: rect(secondary),
          secondaryButtons: secondaryButtons.map((button) => {
            const style = getComputedStyle(button);
            const svg = button.querySelector('svg');
            const svgStyle = svg instanceof SVGElement ? getComputedStyle(svg) : null;
            return {
              ...rect(button),
              fontSize: Number.parseFloat(style.fontSize),
              svg: svg instanceof SVGElement ? {
                ...rect(svg),
                flexShrink: Number.parseFloat(svgStyle?.flexShrink ?? '1'),
              } : null,
            };
          }),
          shellBackground: shellStyle.backgroundImage,
          shellBackgroundSize: shellStyle.backgroundSize,
          shellBackgroundPosition: shellStyle.backgroundPosition,
          stageBackground: stageStyle.backgroundImage,
          stageOverflow: stageStyle.overflow,
          sceneOpacity: sceneStyle.opacity,
          sceneBorderWidth: Number.parseFloat(sceneStyle.borderTopWidth),
          sceneBoxShadow: sceneStyle.boxShadow,
          createBackground: createStyle.backgroundImage,
          joinBackground: joinStyle.backgroundImage,
          soundText: sound.textContent?.replace(/\s+/g, ' ').trim() ?? '',
          statusMedallions: status.querySelectorAll('.lobby-status-medallion').length,
          copyrightContent: copyrightStyle.content,
          secondaryRowGap: Number.parseFloat(secondaryStyle.rowGap),
        };
      });

      expect(layout, '모바일 로비 통합 영역을 읽을 수 있어야 합니다.').not.toBeNull();
      expect(layout.documentScrollWidth, '로비는 가로 스크롤을 만들면 안 됩니다.').toBeLessThanOrEqual(layout.documentClientWidth + 1);
      expect(layout.bodyOverflow, '로비 진입만으로 body 스크롤을 잠그면 안 됩니다.').not.toBe('hidden');
      expect(layout.htmlOverflow, '로비 진입만으로 html 스크롤을 잠그면 안 됩니다.').not.toBe('hidden');
      expect(layout.rootOverflow, '로비 진입만으로 root 스크롤을 잠그면 안 됩니다.').not.toBe('hidden');
      expect(layout.shellBackground, '첨부한 로비 배경 이미지가 앱 셸에 적용되어야 합니다.').toContain('lobby-background-original.png');
      expect(layout.shellBackgroundSize, '배경 이미지는 모바일 viewport 좌우를 덮어야 합니다.').toContain('cover');
      const imageBackgroundPosition = layout.shellBackgroundPosition.split(',').at(-1)?.trim();
      expect(imageBackgroundPosition, '배경 이미지 레이어는 중앙 상단 기준을 유지해야 합니다.').toMatch(/^(?:center|50%) (?:top|0%)$/u);
      const backgroundUrl = /url\(["']?(.*?lobby-background-original\.png)["']?\)/u.exec(layout.shellBackground)?.[1];
      expect(backgroundUrl, '로비가 실제 원본 배경 URL을 로드해야 합니다.').toBeTruthy();
      const naturalSize = await page.evaluate(async (src) => {
        const image = new Image();
        image.src = src;
        await image.decode();
        return { width: image.naturalWidth, height: image.naturalHeight };
      }, backgroundUrl);
      expect(naturalSize, '브라우저가 로드한 배경 이미지의 원본 픽셀 크기를 유지해야 합니다.').toEqual({ width: 768, height: 1334 });
      expect(layout.stageBackground, '장면과 버튼 뒤의 투명 통합 영역을 유지해야 합니다.').toContain('gradient');
      expect(layout.stageOverflow, '통합 영역은 로비 세로 스크롤을 막지 않아야 합니다.').not.toBe('hidden');
      expect(layout.sceneOpacity, '기존 SVG 장면은 첨부 배경과 중복 노출되면 안 됩니다.').toBe('0');
      expect(layout.sceneBorderWidth, '배경 위에 별도 장면 카드 테두리가 있으면 안 됩니다.').toBe(0);
      expect(layout.sceneBoxShadow, '배경 위에 별도 장면 카드 그림자가 있으면 안 됩니다.').toBe('none');
      expect(layout.soundText, '로비 상단 소리 배지는 상태값 대신 효과음 라벨을 보여야 합니다.').toContain('효과음');
      expect(layout.statusMedallions, '온라인 배지 왼쪽의 S 메달은 제거되어야 합니다.').toBe(0);
      expect(layout.copyrightContent, '하단 버튼 아래에 저작권 문구가 표시되어야 합니다.').toContain('2026 stafor94');
      expect(layout.secondaryRowGap, '하단 버튼과 저작권 문구 사이에 여백이 있어야 합니다.').toBeGreaterThanOrEqual(14);
      expect(layout.secondary.height, '보조 버튼 영역은 저작권 문구를 위한 추가 높이를 확보해야 합니다.').toBeGreaterThan(layout.secondaryButtons[0].height + 14);
      expect(layout.createBackground, '방 만들기 버튼은 주황 계열 그라데이션이어야 합니다.').toContain('gradient');
      expect(layout.joinBackground, '방 참가 버튼은 파랑 계열 그라데이션이어야 합니다.').toContain('gradient');
      expect(layout.create.x, '방 만들기 버튼은 통합 영역 안에 있어야 합니다.').toBeGreaterThanOrEqual(layout.stage.x);
      expect(layout.join.right, '방 참가 버튼은 통합 영역 안에 있어야 합니다.').toBeLessThanOrEqual(layout.stage.right);
      expect(layout.join.y, '방 참가 버튼은 방 만들기 버튼 아래에 있어야 합니다.').toBeGreaterThan(layout.create.bottom);
      expect(layout.secondary.bottom, '보조 버튼과 저작권 문구도 통합 영역 안에 있어야 합니다.').toBeLessThanOrEqual(layout.stage.bottom + 1);
      expect(layout.primary.width / layout.viewportWidth, '주요 버튼 영역은 화면 너비의 약 80%여야 합니다.').toBeGreaterThanOrEqual(.78);
      expect(layout.primary.width / layout.viewportWidth, '주요 버튼 영역은 화면 너비의 약 80%여야 합니다.').toBeLessThanOrEqual(.82);
      layout.secondaryButtons.forEach((button) => {
        expect(button.height, '게임 방법과 설정 버튼은 충분한 터치 높이를 가져야 합니다.').toBeGreaterThanOrEqual(44);
        expect(button.fontSize, '게임 방법과 설정 텍스트는 너무 작으면 안 됩니다.').toBeGreaterThanOrEqual(14);
        expect(button.svg?.width ?? 0, '게임 방법과 설정 아이콘은 충분히 커야 합니다.').toBeGreaterThanOrEqual(24);
        expect(button.svg?.height ?? 0, '게임 방법과 설정 아이콘 높이도 충분히 커야 합니다.').toBeGreaterThanOrEqual(24);
        expect(button.svg?.flexShrink ?? 1, '보조 버튼의 아이콘은 텍스트 공간 때문에 축소되면 안 됩니다.').toBe(0);
      });
    });
  });

  test('짧은 모바일 높이에서도 로비 문서 세로 스크롤을 잠그지 않고 가로 스크롤은 만들지 않는다', async ({ page, context }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 560 });
    await primeLobbyStorage(context, { nickname: '스크롤QA' });

    await runQaStep(testInfo, '짧은 모바일 로비 문서 스크롤 잠금 해제 확인', async () => {
      await expectAppShell(page);
      await waitForBlockingOverlayToDisappear(page);

      const before = await page.evaluate(() => {
        const probe = document.createElement('div');
        probe.dataset.qaLobbyScrollProbe = 'true';
        probe.style.width = '1px';
        probe.style.height = '320px';
        probe.style.pointerEvents = 'none';
        probe.setAttribute('aria-hidden', 'true');
        document.body.append(probe);

        return {
          clientWidth: document.documentElement.clientWidth,
          scrollWidth: document.documentElement.scrollWidth,
          scrollHeight: document.documentElement.scrollHeight,
          viewportHeight: window.innerHeight,
          scrollY: window.scrollY,
        };
      });

      expect(before.scrollWidth, '짧은 높이에서도 로비는 가로 스크롤을 만들면 안 됩니다.').toBeLessThanOrEqual(before.clientWidth + 1);
      expect(before.scrollHeight, '검증용 콘텐츠가 추가되면 문서 높이가 viewport보다 커져야 합니다.').toBeGreaterThan(before.viewportHeight + 1);
      expect(before.scrollY, '초기 로비 스크롤 위치는 상단이어야 합니다.').toBe(0);

      await page.evaluate(() => window.scrollTo({ top: 360, left: 0, behavior: 'auto' }));
      await expect.poll(() => page.evaluate(() => window.scrollY), { message: '로비의 세로 문서 스크롤이 잠기면 안 됩니다.' }).toBeGreaterThan(0);

      await page.evaluate(() => {
        window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
        document.querySelector('[data-qa-lobby-scroll-probe="true"]')?.remove();
      });
    });
  });

  test('방 만들기 팝업은 자동으로 키보드를 열지 않고 축소된 화면에서 생성 버튼을 자동 노출한다', async ({ page, context }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 780 });
    await primeLobbyStorage(context, { nickname: '키보드QA' });

    await runQaStep(testInfo, '방 만들기 키보드와 축소 뷰포트 대응 확인', async () => {
      await expectAppShell(page);
      await waitForBlockingOverlayToDisappear(page);
      await page.getByRole('button', { name: '방 만들기', exact: true }).click();

      const dialog = page.getByRole('dialog', { name: '방 만들기' });
      const closeButton = dialog.getByRole('button', { name: '닫기', exact: true });
      const titleInput = page.getByTestId('room-title-input');
      const createButton = page.getByTestId('create-room-button');
      await expect(dialog).toBeVisible();
      await expect(closeButton).toBeFocused();
      await expect(titleInput).not.toBeFocused();

      await titleInput.focus();
      await page.setViewportSize({ width: 390, height: 430 });
      await expect(createButton).toBeInViewport();

      const layout = await dialog.evaluate((element) => {
        const createButton = element.querySelector('[data-testid="create-room-button"]');
        if (!(createButton instanceof HTMLElement)) return null;
        const rect = element.getBoundingClientRect();
        const createRect = createButton.getBoundingClientRect();
        const style = getComputedStyle(element);
        const viewportTop = window.visualViewport?.offsetTop ?? 0;
        const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
        return {
          top: rect.top,
          bottom: rect.bottom,
          height: rect.height,
          viewportTop,
          viewportBottom: viewportTop + viewportHeight,
          overflowY: style.overflowY,
          scrollHeight: element.scrollHeight,
          clientHeight: element.clientHeight,
          createButtonTop: createRect.top,
          createButtonBottom: createRect.bottom,
        };
      });

      expect(layout, '축소 뷰포트의 팝업과 생성 버튼을 읽을 수 있어야 합니다.').not.toBeNull();
      expect(layout.top, '키보드가 열린 높이에서도 팝업 상단이 화면 밖으로 나가면 안 됩니다.').toBeGreaterThanOrEqual(layout.viewportTop - 1);
      expect(layout.bottom, '키보드가 열린 높이에서도 팝업 하단이 화면 밖으로 나가면 안 됩니다.').toBeLessThanOrEqual(layout.viewportBottom + 1);
      expect(layout.height, '팝업 높이는 축소된 뷰포트를 따라야 합니다.').toBeLessThanOrEqual(layout.viewportBottom - layout.viewportTop);
      expect(layout.createButtonTop, '방 생성하기 버튼 상단이 키보드 뒤로 숨으면 안 됩니다.').toBeGreaterThanOrEqual(layout.viewportTop - 1);
      expect(layout.createButtonBottom, '방 생성하기 버튼은 키보드 위의 가시 영역 안에 있어야 합니다.').toBeLessThanOrEqual(layout.viewportBottom + 1);
      expect(layout.overflowY, '키보드로 공간이 줄면 팝업 내부를 스크롤할 수 있어야 합니다.').toBe('auto');
      expect(layout.scrollHeight, '팝업 내용 높이는 최소한 표시 영역만큼 유지되어야 합니다.').toBeGreaterThanOrEqual(layout.clientHeight);
    });
  });
});
