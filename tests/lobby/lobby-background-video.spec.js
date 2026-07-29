import { test, expect } from '@playwright/test';
import { expectAppShell, primeLobbyStorage, waitForBlockingOverlayToDisappear } from '../helpers/ui.js';

test('로비 배경 영상은 무음 자동 반복으로 화면 전체에 배치된다', async ({ page, context }) => {
  await primeLobbyStorage(context, { nickname: '배경영상QA' });
  await expectAppShell(page);
  await waitForBlockingOverlayToDisappear(page);

  const video = page.getByTestId('lobby-background-video');
  await expect(video).toBeAttached();

  const contract = await video.evaluate((element) => {
    if (!(element instanceof HTMLVideoElement)) return null;
    const style = getComputedStyle(element);
    return {
      autoplay: element.autoplay,
      loop: element.loop,
      muted: element.muted,
      playsInline: element.playsInline,
      source: element.currentSrc || element.src,
      objectFit: style.objectFit,
      pointerEvents: style.pointerEvents,
    };
  });

  expect(contract, '로비 배경 영상 요소를 읽을 수 있어야 합니다.').not.toBeNull();
  expect(contract.autoplay).toBe(true);
  expect(contract.loop).toBe(true);
  expect(contract.muted).toBe(true);
  expect(contract.playsInline).toBe(true);
  expect(contract.source).toContain('/Yut/lobby-background.mp4');
  expect(contract.objectFit).toBe('cover');
  expect(contract.pointerEvents).toBe('none');
});
