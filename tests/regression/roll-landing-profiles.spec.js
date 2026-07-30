import { test } from '@playwright/test';
import {
  ROLL_LANDING_PROFILE_CASES,
  startRollLandingProfileGame,
  verifyRollLandingProfile,
} from '../helpers/roll-landing-profile.js';
import { deleteRoomForQa } from '../helpers/rooms.js';

test.describe('desktop Three.js roll landing profiles QA', () => {
  for (const profileCase of ROLL_LANDING_PROFILE_CASES) {
    test(`${profileCase.zone} 등급은 Three.js에서 지정된 착지 프로필과 낙 개수를 사용한다`, async ({ page, context }, testInfo) => {
      let roomId;
      try {
        roomId = await startRollLandingProfileGame(page, context, testInfo, `desktop-${profileCase.zone}`);
        await verifyRollLandingProfile(page, roomId, testInfo, profileCase, 'three');
      } finally {
        await deleteRoomForQa(roomId).catch(() => undefined);
      }
    });
  }
});
