import { test, expect } from '@playwright/test';
import { expectAppShell } from '../helpers/ui.js';
import {
  countHtmlAudioEvents,
  countWebAudioEvents,
  dispatchLatestWebAudioEnded,
  dispatchWebAudioEnded,
  installWebAudioMock,
  readWebAudioEvents,
} from '../helpers/web-audio.js';

const BONUS_RESULT_GLOW_DURATION = '1.4s';

const RESULT_AUDIO_CASES = [
  { result: '도', asset: 'do', tone: 'standard', description: '1칸 이동' },
  { result: '개', asset: 'gae', tone: 'standard', description: '2칸 이동' },
  { result: '걸', asset: 'geol', tone: 'standard', description: '순서 결정', turnOrder: true },
  { result: '빽도', asset: 'backdo', tone: 'backdo', description: '1칸 뒤로', leadingSymbol: '↶' },
  { result: '낙', asset: 'nak', tone: 'fall', description: '던지기 실패' },
  { result: '윷', asset: 'yut', tone: 'bonus', description: '4칸 이동 · 한 번 더', trailingSymbol: '✦' },
  { result: '모', asset: 'mo', tone: 'bonus', description: '5칸 이동 · 한 번 더', trailingSymbol: '✦' },
];

const readGlowState = (surface) => surface.evaluate((node) => {
  const pseudoStyle = getComputedStyle(node, '::after');
  const matStyle = getComputedStyle(node.closest('.roll-mat'));
  return {
    animationName: pseudoStyle.animationName,
    animationDuration: pseudoStyle.animationDuration,
    animationPlayState: pseudoStyle.animationPlayState,
    opacity: Number.parseFloat(pseudoStyle.opacity),
    matAnimationName: matStyle.animationName,
  };
});

const settleDomMutations = (page) => page.evaluate(() => new Promise((resolve) => {
  requestAnimationFrame(() => requestAnimationFrame(resolve));
}));

const expectWebAudioInitialization = async (page) => {
  await expect.poll(() => countWebAudioEvents(page, 'decode'), {
    timeout: 1_000,
    message: '오디오 초기화는 WAV를 fetch/decode preload해야 합니다.',
  }).toBeGreaterThan(0);
  expect(await countWebAudioEvents(page, 'start')).toBe(0);
  expect(await countHtmlAudioEvents(page)).toBe(0);

  await page.locator('body').dispatchEvent('pointerdown');
  await expect.poll(() => countWebAudioEvents(page, 'resume'), {
    timeout: 1_000,
    message: '첫 사용자 입력에서 공유 AudioContext가 resume되어야 합니다.',
  }).toBeGreaterThan(0);
  expect(await countWebAudioEvents(page, 'context-create')).toBe(1);
  expect(await countWebAudioEvents(page, 'start')).toBe(0);
  expect(await countHtmlAudioEvents(page)).toBe(0);
};

test.describe('bonus roll result glow regression', () => {
  test('내 던지기와 상대 던지기 모두 윷·모 텍스트 공개 순간부터 같은 황금 애니메이션을 실행한다', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await expectAppShell(page);

    await page.evaluate(() => {
      document.getElementById('qa-bonus-result-glow-root')?.remove();
      const root = document.createElement('div');
      root.id = 'qa-bonus-result-glow-root';
      root.style.cssText = 'position: fixed; inset: 0; z-index: 2147483647; pointer-events: none;';
      root.innerHTML = `
        <div class="roll-stage resolved-from-pending resolved-roll result-hold-roll" data-roll-path="local">
          <div class="roll-mat bonus-roll">
            <span class="roll-mat-surface"></span>
            <div class="roll-result-presentation" hidden aria-hidden="true">
              <span class="roll-label roll-result-card bonus">윷</span>
            </div>
          </div>
        </div>
        <div class="roll-stage resolved-roll" data-roll-path="remote">
          <div class="roll-mat bonus-roll">
            <span class="roll-mat-surface"></span>
            <div class="roll-result-presentation" hidden aria-hidden="true">
              <span class="roll-label roll-result-card bonus">모</span>
            </div>
          </div>
        </div>
      `;
      document.body.append(root);
    });

    const localStage = page.locator('[data-roll-path="local"]');
    const remoteStage = page.locator('[data-roll-path="remote"]');
    const localSurface = localStage.locator('.roll-mat-surface');
    const remoteSurface = remoteStage.locator('.roll-mat-surface');

    for (const surface of [localSurface, remoteSurface]) {
      await expect(surface, '황금 광원 fixture는 실제 렌더링 viewport 안에 있어야 합니다.').toBeInViewport();
      const beforeReveal = await readGlowState(surface);
      expect(beforeReveal.matAnimationName, '결과 공개 전에 기존 bonus-mat-pop이 먼저 실행되면 안 됩니다.').toBe('none');
      expect(beforeReveal.animationName, '결과 presentation이 숨겨진 동안 황금 결과 애니메이션을 시작하면 안 됩니다.').toBe('none');
      expect(beforeReveal.opacity).toBe(0);
    }

    await page.evaluate(() => {
      document.querySelectorAll('#qa-bonus-result-glow-root .roll-result-presentation').forEach((presentation) => {
        presentation.hidden = false;
        presentation.setAttribute('aria-hidden', 'false');
      });
    });

    for (const [pathName, surface] of [['내 던지기', localSurface], ['상대 던지기', remoteSurface]]) {
      await expect.poll(async () => readGlowState(surface), {
        timeout: 500,
        message: `${pathName}에서 윷·모 텍스트 공개 직후 황금 애니메이션이 시작되어야 합니다.`,
      }).toMatchObject({
        animationName: 'bonus-result-gold-glow',
        animationDuration: BONUS_RESULT_GLOW_DURATION,
        animationPlayState: 'running',
        matAnimationName: 'none',
      });

      await expect.poll(async () => (await readGlowState(surface)).opacity, {
        timeout: 500,
        message: `${pathName}의 황금 광원이 결과 공개 직후 실제로 보여야 합니다.`,
      }).toBeGreaterThan(0);
    }

    await page.locator('#qa-bonus-result-glow-root').evaluate((node) => node.remove());
  });

  test('일반·순서 정하기 결과 카드는 숨겨진 동안 재생하지 않고 실제 공개 시 결과별 음성을 한 번 재생한다', async ({ page }) => {
    await installWebAudioMock(page);
    await expectAppShell(page);
    await expectWebAudioInitialization(page);

    await page.evaluate(() => {
      document.getElementById('qa-yut-speech-root')?.remove();
      const root = document.createElement('div');
      root.id = 'qa-yut-speech-root';
      root.innerHTML = `
        <div class="roll-stage resolved-roll">
          <div class="roll-mat">
            <div class="roll-result-presentation" hidden aria-hidden="true">
              <span class="roll-label roll-result-card standard">
                <strong class="roll-result-name"><span>도</span></strong>
                <small class="roll-result-description">1칸 이동</small>
              </span>
            </div>
          </div>
        </div>
      `;
      document.body.append(root);
    });

    for (const audioCase of RESULT_AUDIO_CASES) {
      const baseline = await countWebAudioEvents(page, 'start', audioCase.asset);
      await page.evaluate((nextCase) => {
        const root = document.getElementById('qa-yut-speech-root');
        const presentation = root?.querySelector('.roll-result-presentation');
        const card = root?.querySelector('.roll-result-card');
        const name = root?.querySelector('.roll-result-name');
        const description = root?.querySelector('.roll-result-description');
        if (!(presentation instanceof HTMLElement) || !(card instanceof HTMLElement) || !(name instanceof HTMLElement) || !(description instanceof HTMLElement)) {
          throw new Error('결과 카드 fixture를 찾지 못했습니다.');
        }
        presentation.hidden = true;
        presentation.setAttribute('aria-hidden', 'true');
        presentation.dataset.turnOrder = nextCase.turnOrder ? 'true' : 'false';
        card.className = `roll-label roll-result-card ${nextCase.tone}`;
        name.replaceChildren();
        if (nextCase.leadingSymbol) {
          const leading = document.createElement('span');
          leading.className = 'roll-result-symbol';
          leading.setAttribute('aria-hidden', 'true');
          leading.textContent = nextCase.leadingSymbol;
          name.append(leading);
        }
        const resultLabel = document.createElement('span');
        resultLabel.textContent = nextCase.result;
        name.append(resultLabel);
        if (nextCase.trailingSymbol) {
          const trailing = document.createElement('span');
          trailing.className = 'roll-result-symbol';
          trailing.setAttribute('aria-hidden', 'true');
          trailing.textContent = nextCase.trailingSymbol;
          name.append(trailing);
        }
        description.textContent = nextCase.description;
      }, audioCase);
      await settleDomMutations(page);

      expect(
        await countWebAudioEvents(page, 'start', audioCase.asset),
        `${audioCase.result} 결과의 부모 presentation이 숨겨진 동안 음성을 선재생하면 안 됩니다.`,
      ).toBe(baseline);

      await page.evaluate(() => {
        const presentation = document.querySelector('#qa-yut-speech-root .roll-result-presentation');
        if (!(presentation instanceof HTMLElement)) throw new Error('결과 presentation fixture를 찾지 못했습니다.');
        presentation.hidden = false;
        presentation.setAttribute('aria-hidden', 'false');
      });

      await expect.poll(() => countWebAudioEvents(page, 'start', audioCase.asset), {
        timeout: 1_000,
        message: `${audioCase.result} 결과 카드가 실제 공개되면 ${audioCase.asset}.wav Web Audio source가 한 번 재생되어야 합니다.`,
      }).toBe(baseline + 1);
      const starts = await readWebAudioEvents(page, 'start', audioCase.asset);
      expect(starts.at(-1)?.gain).toBe(0.9);

      await page.evaluate(() => {
        const presentation = document.querySelector('#qa-yut-speech-root .roll-result-presentation');
        presentation?.classList.toggle('qa-rerender');
      });
      await settleDomMutations(page);
      expect(
        await countWebAudioEvents(page, 'start', audioCase.asset),
        `${audioCase.result} 결과의 동일 DOM 갱신으로 음성이 중복 재생되면 안 됩니다.`,
      ).toBe(baseline + 1);
    }

    expect(await countHtmlAudioEvents(page)).toBe(0);
    await page.locator('#qa-yut-speech-root').evaluate((node) => node.remove());
  });

  test('결과 표시가 사라져도 음성을 중단하지 않고 윷 보너스 음성을 이어 재생한다', async ({ page }) => {
    await installWebAudioMock(page);
    await expectAppShell(page);

    await page.evaluate(() => {
      document.getElementById('qa-yut-speech-root')?.remove();
      const root = document.createElement('div');
      root.id = 'qa-yut-speech-root';
      root.innerHTML = `
        <div class="roll-result-presentation" aria-hidden="false">
          <span class="roll-label roll-result-card bonus">
            <strong class="roll-result-name"><span>윷</span><span class="roll-result-symbol" aria-hidden="true">✦</span></strong>
            <small class="roll-result-description">4칸 이동 · 한 번 더</small>
          </span>
        </div>
      `;
      document.body.append(root);
    });

    await expect.poll(() => countWebAudioEvents(page, 'start', 'yut'), {
      timeout: 1_000,
      message: '윷 결과가 보이면 결과 음성이 한 번 재생되어야 합니다.',
    }).toBe(1);

    const stopCountBeforeRemoval = await countWebAudioEvents(page, 'stop', 'yut');
    await page.locator('#qa-yut-speech-root').evaluate((node) => node.remove());
    await settleDomMutations(page);

    expect(
      await countWebAudioEvents(page, 'stop', 'yut'),
      '결과 DOM이 사라졌다는 이유만으로 재생 중인 음성 source를 중단하면 안 됩니다.',
    ).toBe(stopCountBeforeRemoval);

    await dispatchLatestWebAudioEnded(page, 'yut');

    await expect.poll(() => countWebAudioEvents(page, 'start', 'bonus'), {
      timeout: 1_000,
      message: '윷 결과 음성이 끝나면 결과 표시 제거 여부와 관계없이 보너스 음성이 재생되어야 합니다.',
    }).toBe(1);
    expect((await readWebAudioEvents(page, 'start', 'bonus')).at(-1)?.gain).toBe(0.9);
    expect(await countHtmlAudioEvents(page)).toBe(0);
  });

  test('새 결과가 이전 음성을 교체하면 stale 종료 콜백은 보너스를 재생하지 않는다', async ({ page }) => {
    await installWebAudioMock(page);
    await expectAppShell(page);

    await page.evaluate(() => {
      document.getElementById('qa-yut-speech-root')?.remove();
      const root = document.createElement('div');
      root.id = 'qa-yut-speech-root';
      root.innerHTML = `
        <div class="roll-result-presentation" aria-hidden="false">
          <span class="roll-label roll-result-card bonus">
            <strong class="roll-result-name"><span>윷</span><span class="roll-result-symbol" aria-hidden="true">✦</span></strong>
          </span>
        </div>
      `;
      document.body.append(root);
    });
    await expect.poll(() => countWebAudioEvents(page, 'start', 'yut')).toBe(1);

    await page.evaluate(() => {
      const result = document.querySelector('#qa-yut-speech-root .roll-result-name > span:not(.roll-result-symbol)');
      if (!(result instanceof HTMLElement)) throw new Error('결과 label fixture를 찾지 못했습니다.');
      result.textContent = '모';
    });
    await expect.poll(() => countWebAudioEvents(page, 'start', 'mo')).toBe(1);
    await expect.poll(() => countWebAudioEvents(page, 'stop', 'yut')).toBe(1);

    await dispatchWebAudioEnded(page, 'yut', 0);
    await settleDomMutations(page);
    expect(await countWebAudioEvents(page, 'start', 'bonus')).toBe(0);

    await dispatchLatestWebAudioEnded(page, 'mo');
    await expect.poll(() => countWebAudioEvents(page, 'start', 'bonus')).toBe(1);
    expect(await countHtmlAudioEvents(page)).toBe(0);
  });
});
