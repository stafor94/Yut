import { test, expect } from '@playwright/test';
import { collectScreenState, createRoomFromLobby, primeLobbyStorage, runQaStep } from '../helpers/ui.js';
import { hasFirebaseConfig, loadFirebaseConfig, makeQaName, normalizeQaNickname } from '../helpers/env.js';
import { deleteRoomForQa, findRoomIdByTitle, getRoomPlayersForQa, getRoomStateForQa, rememberRoomIdFromPage } from '../helpers/rooms.js';

const encodeFirestoreValue = (value) => {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'number') return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encodeFirestoreValue) } };
  if (typeof value === 'object') return { mapValue: { fields: Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, encodeFirestoreValue(nested)])) } };
  throw new Error(`지원하지 않는 Firestore 값입니다: ${typeof value}`);
};

async function readFirebaseAccessTokenFromPage(page) {
  return page.evaluate(async () => {
    const findToken = (value, depth = 0) => {
      if (!value || depth > 8) return '';
      if (typeof value === 'string') return value.startsWith('eyJ') && value.split('.').length === 3 ? value : '';
      if (Array.isArray(value)) {
        for (const nested of value) {
          const token = findToken(nested, depth + 1);
          if (token) return token;
        }
        return '';
      }
      if (typeof value === 'object') {
        if (typeof value.accessToken === 'string' && value.accessToken.startsWith('eyJ')) return value.accessToken;
        for (const nested of Object.values(value)) {
          const token = findToken(nested, depth + 1);
          if (token) return token;
        }
      }
      return '';
    };
    return new Promise((resolve) => {
      const request = indexedDB.open('firebaseLocalStorageDb');
      request.onerror = () => resolve('');
      request.onsuccess = () => {
        const database = request.result;
        const stores = Array.from(database.objectStoreNames);
        if (!stores.length) {
          database.close();
          resolve('');
          return;
        }
        let pending = stores.length;
        let resolved = false;
        for (const storeName of stores) {
          const transaction = database.transaction(storeName, 'readonly');
          const getAllRequest = transaction.objectStore(storeName).getAll();
          const complete = (token = '') => {
            pending -= 1;
            if (token && !resolved) {
              resolved = true;
              database.close();
              resolve(token);
            } else if (!resolved && pending === 0) {
              database.close();
              resolve('');
            }
          };
          getAllRequest.onerror = () => complete();
          getAllRequest.onsuccess = () => complete(findToken(getAllRequest.result));
        }
      };
    });
  });
}

async function patchRoomStateFromPage(page, roomId, patch) {
  const config = await loadFirebaseConfig();
  if (!config?.projectId) throw new Error('Firebase projectId가 없습니다.');
  const emulatorEndpoint = String(process.env.FIRESTORE_EMULATOR_HOST ?? '').trim();
  const accessToken = emulatorEndpoint ? '' : await readFirebaseAccessTokenFromPage(page);
  if (!emulatorEndpoint && !accessToken) throw new Error('브라우저 Firebase Auth 토큰을 읽지 못했습니다.');
  const origin = emulatorEndpoint ? `http://${emulatorEndpoint}` : 'https://firestore.googleapis.com';
  const base = `${origin}/v1/projects/${encodeURIComponent(config.projectId)}/databases/(default)/documents/rooms/${encodeURIComponent(roomId)}/state/current`;
  const url = new URL(base);
  Object.keys(patch).forEach((fieldPath) => url.searchParams.append('updateMask.fieldPaths', fieldPath));
  const fields = Object.fromEntries(Object.entries(patch).map(([key, value]) => [key, encodeFirestoreValue(value)]));
  const response = await fetch(url, {
    method: 'PATCH',
    headers: { ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}), 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
  });
  if (!response.ok) throw new Error(`Firestore state patch 실패 ${response.status}: ${await response.text()}`);
}

const AUTOPLAY_FIXTURE_TIMEOUT_MS = 20_000;

test.describe('mobile autoplay control panel scroll QA', () => {
  let roomId;

  test.afterEach(async () => {
    await deleteRoomForQa(roomId).catch(() => undefined);
  });

  test('authoritative 자동 플레이 상태는 스크롤과 관계없이 play-controls 안에서 복귀까지 유지된다', async ({ page, context }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-galaxy', '412×915 mobile-galaxy project에서만 실행합니다.');
    expect(await hasFirebaseConfig(), 'Firebase 설정이 없어 온라인 QA를 실행할 수 없습니다.').toBe(true);
    expect(page.viewportSize()).toEqual({ width: 412, height: 915 });

    const hostName = normalizeQaNickname(makeQaName(testInfo, 'autoplay-host'));
    const roomTitle = makeQaName(testInfo, 'autoplay-room');
    await primeLobbyStorage(context, { nickname: hostName, maxPlayers: '2', playMode: 'individual', itemMode: 'false', stackedRollMode: 'false', pieceCount: '4' });
    await context.addInitScript(() => {
      window.__YUT_QA_TURN_ORDER_RESULT_QUEUE__ = ['모'];
      window.__YUT_QA_AI_TURN_ORDER_RESULT_QUEUE__ = ['도'];
    });

    let hostPlayer;
    let hostTurnIndex;

    await runQaStep(testInfo, 'AI 게임을 시작하고 로컬 좌석을 authoritative 자동 플레이 상태로 설정', async () => {
      await createRoomFromLobby(page, roomTitle);
      roomId = await rememberRoomIdFromPage(page) ?? await findRoomIdByTitle(roomTitle);
      expect(roomId, '생성된 QA 방 ID가 필요합니다.').toBeTruthy();
      await page.getByTestId('add-ai-P2').click();
      await expect(page.getByTestId('start-game-button')).toBeEnabled({ timeout: 15_000 });
      await page.getByTestId('start-game-button').click();
      await expect(page.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 });
      await expect.poll(async () => {
        const screen = await collectScreenState(page);
        const debug = screen.yutDebug ?? {};
        return Array.isArray(debug.turnOrderIds)
          && debug.turnOrderIds.length === 2
          && !debug.turnOrderPhase?.active
          && !debug.turnOrderIntro;
      }, { timeout: 40_000, message: '순서 정하기가 끝나 자동 플레이 fixture를 적용할 수 있어야 합니다.' }).toBe(true);

      const [state, players] = await Promise.all([getRoomStateForQa(roomId), getRoomPlayersForQa(roomId)]);
      expect(state, '현재 game state가 필요합니다.').toBeTruthy();
      hostPlayer = players.find((player) => !player.isAI && player.nickname === hostName) ?? players.find((player) => !player.isAI);
      expect(hostPlayer?.id, '방장 player ID가 필요합니다.').toBeTruthy();
      const turnOrderIds = Array.isArray(state.turnOrderIds) ? state.turnOrderIds : [];
      hostTurnIndex = turnOrderIds.indexOf(hostPlayer.id);
      expect(hostTurnIndex, '방장이 turn order에 포함되어야 합니다.').toBeGreaterThanOrEqual(0);
      await patchRoomStateFromPage(page, roomId, {
        turnIndex: hostTurnIndex,
        roll: null,
        rollStack: [],
        selectedRollStackIndex: null,
        rollStackClosed: false,
        itemPromptTiming: null,
        pendingAfterMoveTurnIndex: null,
        pendingGoldenYutSelection: null,
        pendingTrapPlacement: null,
        lastMovedPieceIds: [],
        lastMovedSeatId: '',
        waitingForPlayersReady: false,
        turnActionTimeoutCountBySeatId: { ...(state.turnActionTimeoutCountBySeatId ?? {}), [hostPlayer.id]: 2 },
        autoPlayBySeatId: { ...(state.autoPlayBySeatId ?? {}), [hostPlayer.id]: true },
        turnDeadlineAt: Date.now() + AUTOPLAY_FIXTURE_TIMEOUT_MS,
        turnDeadlineKind: 'roll',
        turnVersion: Number(state.turnVersion ?? 0) + 1,
      });
      await page.reload();
      await expect(page.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('auto-play-control-panel')).toBeVisible({ timeout: 20_000 });
    });

    let autoPlayControlsHeight = 0;

    await runQaStep(testInfo, '자동 플레이 패널이 조작 영역 전체를 대체하고 스크롤 후에도 같은 DOM 위치에 유지', async () => {
      const controls = page.getByTestId('play-controls');
      const panel = page.getByTestId('auto-play-control-panel');
      await expect(panel).toContainText('AI 자동 플레이 중...');
      await expect(panel).toContainText(`${hostName}님의 행동을 어려움 AI가 대신 판단합니다.`);
      await expect(page.getByTestId('resume-human-control-button')).toBeVisible();
      await expect(controls.locator('.time-limit-bar')).toHaveCount(0);
      await expect(controls.locator('.roll-timing-meter')).toHaveCount(0);
      await expect(controls.getByTestId('roll-yut-button')).toHaveCount(0);
      await expect(controls.getByTestId('move-piece-button')).toHaveCount(0);

      const containment = await page.evaluate(() => {
        const controlsElement = document.querySelector('[data-testid="play-controls"]');
        const panelElement = document.querySelector('[data-testid="auto-play-control-panel"]');
        if (!(controlsElement instanceof HTMLElement) || !(panelElement instanceof HTMLElement)) return null;
        const controlsRect = controlsElement.getBoundingClientRect();
        const panelRect = panelElement.getBoundingClientRect();
        return {
          closest: panelElement.closest('[data-testid="play-controls"]') === controlsElement,
          inside: panelRect.left >= controlsRect.left - 1
            && panelRect.right <= controlsRect.right + 1
            && panelRect.top >= controlsRect.top - 1
            && panelRect.bottom <= controlsRect.bottom + 1,
          height: controlsRect.height,
        };
      });
      expect(containment).toMatchObject({ closest: true, inside: true });
      autoPlayControlsHeight = containment?.height ?? 0;
      expect(autoPlayControlsHeight).toBeGreaterThan(100);

      await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }));
      await expect.poll(() => page.evaluate(() => Math.round(window.scrollY)), { timeout: 5_000 }).toBeGreaterThan(0);
      await expect(panel).toBeAttached();
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
      await controls.scrollIntoViewIfNeeded();
      await expect(panel).toBeVisible();
      await expect(panel).toContainText('AI 자동 플레이 중...');
    });

    await runQaStep(testInfo, '복귀 요청 pending과 authoritative 완료를 polling하고 일반 조작 UI를 복구', async () => {
      await page.evaluate(() => {
        const observation = { pendingTextSeen: false, disabledSeen: false };
        const inspect = () => {
          const button = document.querySelector('[data-testid="resume-human-control-button"]');
          if (!(button instanceof HTMLButtonElement)) return;
          if (button.textContent?.includes('통제권 가져오는 중...')) observation.pendingTextSeen = true;
          if (button.disabled) observation.disabledSeen = true;
        };
        const observer = new MutationObserver(inspect);
        observer.observe(document.body, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['disabled'] });
        inspect();
        window.__YUT_QA_AUTOPLAY_RESUME_OBSERVATION__ = observation;
        window.__YUT_QA_STOP_AUTOPLAY_RESUME_OBSERVATION__ = () => observer.disconnect();
      });

      await page.getByTestId('resume-human-control-button').click();
      await expect.poll(() => page.evaluate(() => window.__YUT_QA_AUTOPLAY_RESUME_OBSERVATION__), {
        timeout: 10_000,
        message: '복귀 요청 중 문구와 disabled 상태를 모두 관찰해야 합니다.',
      }).toMatchObject({ pendingTextSeen: true, disabledSeen: true });

      await expect.poll(async () => {
        const state = await getRoomStateForQa(roomId);
        return {
          autoPlay: state?.autoPlayBySeatId?.[hostPlayer.id] === true,
          timeoutCount: Number(state?.turnActionTimeoutCountBySeatId?.[hostPlayer.id] ?? -1),
        };
      }, { timeout: 20_000, message: 'resume_human_control authoritative state가 자동 플레이와 timeout 횟수를 초기화해야 합니다.' }).toEqual({ autoPlay: false, timeoutCount: 0 });

      await page.evaluate(() => window.__YUT_QA_STOP_AUTOPLAY_RESUME_OBSERVATION__?.());
      await expect(page.getByTestId('auto-play-control-panel')).toBeHidden({ timeout: 20_000 });

      const state = await getRoomStateForQa(roomId);
      await patchRoomStateFromPage(page, roomId, {
        turnIndex: hostTurnIndex,
        roll: null,
        rollStack: [],
        selectedRollStackIndex: null,
        rollStackClosed: false,
        itemPromptTiming: null,
        pendingAfterMoveTurnIndex: null,
        pendingGoldenYutSelection: null,
        pendingTrapPlacement: null,
        lastMovedPieceIds: [],
        lastMovedSeatId: '',
        waitingForPlayersReady: false,
        turnActionTimeoutCountBySeatId: { ...(state?.turnActionTimeoutCountBySeatId ?? {}), [hostPlayer.id]: 0 },
        autoPlayBySeatId: { ...(state?.autoPlayBySeatId ?? {}), [hostPlayer.id]: false },
        turnDeadlineAt: Date.now() + AUTOPLAY_FIXTURE_TIMEOUT_MS,
        turnDeadlineKind: 'roll',
        turnVersion: Number(state?.turnVersion ?? 0) + 1,
      });
      await page.reload();
      await expect(page.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('auto-play-control-panel')).toHaveCount(0);
      await expect(page.locator('.roll-timing-meter')).toBeVisible({ timeout: 20_000 });
      await expect(page.getByTestId('roll-yut-button')).toBeEnabled({ timeout: 20_000 });
      await expect(page.locator('.time-limit-bar')).toBeVisible({ timeout: 20_000 });

      const restoredHeight = await page.getByTestId('play-controls').evaluate((element) => element.getBoundingClientRect().height);
      expect(Math.abs(restoredHeight - autoPlayControlsHeight), '자동 플레이 시작·종료 전후 play-controls 높이 차이가 커지면 안 됩니다.').toBeLessThanOrEqual(8);
    });
  });
});
