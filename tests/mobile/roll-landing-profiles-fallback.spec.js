import { test } from '@playwright/test';
import {
  ROLL_LANDING_PROFILE_CASES,
  blockThreeRendererModules,
  startRollLandingProfileGame,
  verifyRollLandingProfile,
} from '../helpers/roll-landing-profile.js';
import { deleteRoomForQa } from '../helpers/rooms.js';

const GALAXY_VIEWPORT = { width: 412, height: 915 };

test.describe('Galaxy CSS fallback roll landing profiles QA', () => {
  for (const profileCase of ROLL_LANDING_PROFILE_CASES) {
    test(`${profileCase.zone} 등급은 CSS fallback에서 지정된 착지 프로필과 낙 개수를 사용한다`, async ({ page, context }, testInfo) => {
      let roomId;
      try {
        await blockThreeRendererModules(context);
        await page.setViewportSize(GALAXY_VIEWPORT);
        roomId = await startRollLandingProfileGame(page, context, testInfo, `galaxy-${profileCase.zone}`);
        await verifyRollLandingProfile(page, roomId, testInfo, profileCase, 'fallback');
      } finally {
        await deleteRoomForQa(roomId).catch(() => undefined);
      }
    });
  }
});
