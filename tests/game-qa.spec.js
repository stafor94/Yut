import { test, expect, devices } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { initializeApp, getApps } from 'firebase/app';
import { collection, deleteDoc, doc, getDocs, getFirestore, query, where, writeBatch } from 'firebase/firestore';

const screenshotDir = path.join(process.cwd(), 'screenshots');
const consoleLogPath = path.join(process.cwd(), 'console-log.txt');
const roomSubcollections = ['actions', 'boardItems', 'players', 'seats', 'state', 'sequences', 'processedActions'];
const rememberedRoomIds = new Set();

async function loadFirebaseConfig() {
  const fileEnv = {};
  for (const fileName of ['.env.production', '.env.local', '.env']) {
    const filePath = path.join(process.cwd(), fileName);
    const content = await fs.readFile(filePath, 'utf8').catch(() => '');
    for (const line of content.split('\n')) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (match) fileEnv[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
    }
  }

  const readEnv = (key) => process.env[key] || fileEnv[key];
  const config = {
    apiKey: readEnv('VITE_FIREBASE_API_KEY'),
    authDomain: readEnv('VITE_FIREBASE_AUTH_DOMAIN'),
    projectId: readEnv('VITE_FIREBASE_PROJECT_ID'),
    storageBucket: readEnv('VITE_FIREBASE_STORAGE_BUCKET'),
    messagingSenderId: readEnv('VITE_FIREBASE_MESSAGING_SENDER_ID'),
    appId: readEnv('VITE_FIREBASE_APP_ID'),
  };
  return Object.values(config).every(Boolean) ? config : null;
}

let testDbPromise;
async function getTestDb() {
  if (!testDbPromise) {
    testDbPromise = (async () => {
      const config = await loadFirebaseConfig();
      if (!config) return null;
      const app = getApps().find((candidate) => candidate.name === 'qa-cleanup') ?? initializeApp(config, 'qa-cleanup');
      return getFirestore(app);
    })();
  }
  return testDbPromise;
}

async function rememberRoomIdByTitle(title) {
  const db = await getTestDb();
  if (!db) return null;
  const snapshot = await getDocs(query(collection(db, 'rooms'), where('title', '==', title)));
  const roomId = snapshot.docs[0]?.id ?? null;
  if (roomId) rememberedRoomIds.add(roomId);
  return roomId;
}

async function deleteRoomForQa(roomId) {
  const db = await getTestDb();
  if (!db || !roomId) return;
  for (const subcollectionName of roomSubcollections) {
    const snapshot = await getDocs(collection(db, 'rooms', roomId, subcollectionName));
    for (let index = 0; index < snapshot.docs.length; index += 450) {
      const batch = writeBatch(db);
      snapshot.docs.slice(index, index + 450).forEach((documentSnapshot) => batch.delete(documentSnapshot.ref));
      await batch.commit();
    }
  }
  await deleteDoc(doc(db, 'rooms', roomId));
}

function isTransientFirestoreConsoleError(message) {
  return (
    /Failed to load resource: the server responded with a status of (400|409)/.test(message) ||
    (/firestore/i.test(message) && /(Commit|already-exists|400|409)/i.test(message))
  );
}

function assertConsoleErrorsWithinQaAllowance(consoleErrors) {
  const transientFirestoreErrors = consoleErrors.filter(isTransientFirestoreConsoleError);
  const blockingErrors = consoleErrors.filter((message) => !isTransientFirestoreConsoleError(message));
  expect(blockingErrors, `Console/page errors:\n${blockingErrors.join('\n')}`).toEqual([]);
  expect(transientFirestoreErrors.length, `반복 Firestore 콘솔 에러:\n${transientFirestoreErrors.join('\n')}`).toBeLessThanOrEqual(1);
}

function attachConsoleErrorCapture(page, consoleErrors) {
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(error.message));
}


function formatQaError(error) {
  if (error instanceof Error) return error.stack || error.message;
  return String(error);
}

async function appendQaStepLog(testInfo, status, step, details = '') {
  const suffix = details ? ` - ${details}` : '';
  await fs.appendFile(consoleLogPath, `[${new Date().toISOString()}] [${testInfo.project.name}] [${status}] ${step}${suffix}\n`);
}

async function runQaStep(testInfo, step, action) {
  await appendQaStepLog(testInfo, 'START', step);
  return test.step(step, async () => {
    try {
      const result = await action();
      await appendQaStepLog(testInfo, 'PASS', step);
      return result;
    } catch (error) {
      await appendQaStepLog(testInfo, 'FAIL', step, formatQaError(error));
      throw error;
    }
  });
}

async function primeQaLobbyStorage(context, { nickname, maxPlayers = '2', playMode = 'individual', itemMode = 'false' }) {
  await context.addInitScript(({ nickname: nextNickname, maxPlayers: nextMaxPlayers, playMode: nextPlayMode, itemMode: nextItemMode }) => {
    window.localStorage.setItem('yut-online:nickname', nextNickname);
    window.localStorage.setItem('yut-online:maxPlayers', nextMaxPlayers);
    window.localStorage.setItem('yut-online:playMode', nextPlayMode);
    window.localStorage.setItem('yut-online:itemMode', nextItemMode);
  }, { nickname, maxPlayers, playMode, itemMode });
}

async function expectTwoPlayerGameReady(page, firstNickname, secondNickname) {
  await expect(page.getByTestId('game-screen')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('play-timer')).toBeVisible();
  await expect(page.getByTestId('players-panel')).toContainText(firstNickname);
  await expect(page.getByTestId('players-panel')).toContainText(secondNickname);
  await expect(page.getByTestId('turn-indicator')).toBeVisible();
  await expect(page.getByTestId('game-board')).toBeVisible();
}

async function playOneVisibleTurn(page) {
  const rollButton = page.getByTestId('roll-yut-button');
  if (!(await rollButton.isVisible().catch(() => false))) return false;
  await expect(rollButton).toBeEnabled({ timeout: 15_000 });
  await rollButton.click();
  const moveButton = page.getByTestId('move-piece-button');
  if (await moveButton.isVisible({ timeout: 4_000 }).catch(() => false)) {
    await expect(moveButton).toBeEnabled({ timeout: 15_000 });
    await moveButton.click();
  }
  return true;
}

async function waitForAnyRollButtonVisible(pages, timeout = 20_000) {
  await expect.poll(async () => {
    for (const page of pages) {
      if (await page.getByTestId('roll-yut-button').isVisible().catch(() => false)) return true;
    }
    return false;
  }, { message: '차례 순서 연출이 끝난 뒤 현재 턴 기기의 윷 던지기 버튼이 보여야 합니다.', timeout }).toBeTruthy();
}

async function cleanupRememberedRooms() {
  const errors = [];
  for (const roomId of Array.from(rememberedRoomIds)) {
    try {
      await deleteRoomForQa(roomId);
      rememberedRoomIds.delete(roomId);
    } catch (error) {
      errors.push(`${roomId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  expect(errors, `QA 방 폭파 실패:\n${errors.join('\n')}`).toEqual([]);
}

async function saveStepScreenshot(page, testInfo, step) {
  if (process.env.CI) return;
  await fs.mkdir(screenshotDir, { recursive: true });
  const fileName = `${testInfo.project.name.replaceAll(' ', '-')}-${String(testInfo.retry)}-${step}.png`;
  await page.screenshot({ path: path.join(screenshotDir, fileName), fullPage: true });
}

test.beforeEach(async ({ page }, testInfo) => {
  await fs.mkdir(screenshotDir, { recursive: true });
  await fs.appendFile(consoleLogPath, `\n## ${testInfo.project.name} - ${testInfo.title}\n`);
  page.on('console', async (message) => {
    const line = `[${new Date().toISOString()}] [${testInfo.project.name}] ${message.type()}: ${message.text()}\n`;
    await fs.appendFile(consoleLogPath, line);
  });
});

test.afterEach(async () => {
  await cleanupRememberedRooms();
});

test('mobile game QA: room creation, AI fill, start, and short autoplay', async ({ page }, testInfo) => {
  const consoleErrors = [];
  const qaRoomTitle = `QA 자동 테스트 ${testInfo.project.name} ${Date.now()}-${testInfo.retry}-${testInfo.workerIndex}`;
  attachConsoleErrorCapture(page, consoleErrors);

  try {
    await runQaStep(testInfo, '01 로비 진입', async () => {
      await page.goto('/');
      await expect(page.getByTestId('app-shell')).toBeVisible();
      await saveStepScreenshot(page, testInfo, '01-lobby');
    });

    await runQaStep(testInfo, '02 방 생성 후 대기실 진입', async () => {
      await page.getByTestId('room-title-input').fill(qaRoomTitle);
      await page.getByTestId('create-room-button').click();
      await expect(page.getByTestId('waiting-room')).toBeVisible({ timeout: 25_000 });
      await expect.poll(() => rememberRoomIdByTitle(qaRoomTitle), { message: '생성한 QA 방 ID를 기억해야 합니다.' }).toBeTruthy();
      await saveStepScreenshot(page, testInfo, '02-waiting-room');
    });

    await runQaStep(testInfo, '03 AI 채우기 및 시작 버튼 활성화 확인', async () => {
      for (const label of ['P2', 'P3', 'P4']) {
        const button = page.getByTestId(`add-ai-${label}`);
        if (await button.isVisible()) await button.click();
      }
      await expect(page.getByTestId('start-game-button')).toBeEnabled();
      await saveStepScreenshot(page, testInfo, '03-ai-filled');
    });

    await runQaStep(testInfo, '04 게임 시작 화면 확인', async () => {
      await page.getByTestId('start-game-button').click();
      await expect(page.getByTestId('game-screen')).toBeVisible({ timeout: 8_000 });
      await expect(page.getByTestId('play-timer')).toBeVisible();
      await expect(page.getByTestId('players-panel')).toContainText('P1');
      await expect(page.getByTestId('turn-indicator')).toBeVisible();
      await expect(page.getByTestId('game-board')).toBeVisible();
      await expect(page.locator('[data-testid^="piece-"]').first()).toBeVisible();
      await saveStepScreenshot(page, testInfo, '04-game-started');
    });

    for (let turn = 1; turn <= 10; turn += 1) {
      await runQaStep(testInfo, `05-${turn} 짧은 자동 진행 턴`, async () => {
        const rollButton = page.getByTestId('roll-yut-button');
        if (await rollButton.isVisible().catch(() => false)) {
          await expect(rollButton).toBeEnabled({ timeout: 15_000 });
          await rollButton.click();
          const moveButton = page.getByTestId('move-piece-button');
          if (await moveButton.isVisible({ timeout: 4_000 }).catch(() => false)) {
            await expect(moveButton).toBeEnabled({ timeout: 15_000 });
            await moveButton.click();
          }
        }
        await expect(page.getByTestId('game-screen')).toBeVisible();
        await saveStepScreenshot(page, testInfo, `05-turn-${turn}`);
        await page.waitForTimeout(600);
      });
    }

    await runQaStep(testInfo, '06 콘솔 에러 허용 범위 확인', async () => {
      assertConsoleErrorsWithinQaAllowance(consoleErrors);
    });
  } finally {
    await cleanupRememberedRooms();
  }
});

test.describe('mobile device-to-device QA', () => {
  test.skip(({ browserName }) => browserName !== 'webkit', '기기 간 대전은 iPad/WebKit 프로젝트에서 한 번만 실행합니다.');

  test('mobile game QA: iPad and Galaxy join one individual match', async ({ playwright }, testInfo) => {
    const consoleErrors = [];
    const qaRoomTitle = `QA 기기 대전 ${Date.now()}-${testInfo.retry}-${testInfo.workerIndex}`;
    const ipadNickname = 'QA iPad';
    const galaxyNickname = 'QA Galaxy';
    const baseURL = testInfo.project.use.baseURL ?? 'http://127.0.0.1:4173';
    const ipadBrowser = await playwright.webkit.launch();
    const galaxyBrowser = await playwright.chromium.launch();
    const ipadContext = await ipadBrowser.newContext({ ...devices['iPad (gen 7)'], viewport: { width: 810, height: 1080 } });
    const galaxyContext = await galaxyBrowser.newContext({ ...devices['Galaxy S9+'], viewport: { width: 412, height: 915 }, deviceScaleFactor: 3.5 });

    try {
      await runQaStep(testInfo, '기기전 01 로컬 스토리지 준비', async () => {
        await primeQaLobbyStorage(ipadContext, { nickname: ipadNickname });
        await primeQaLobbyStorage(galaxyContext, { nickname: galaxyNickname });
      });

      const ipadPage = await runQaStep(testInfo, '기기전 02 iPad 페이지 생성', async () => ipadContext.newPage());
      const galaxyPage = await runQaStep(testInfo, '기기전 03 Galaxy 페이지 생성', async () => galaxyContext.newPage());
      attachConsoleErrorCapture(ipadPage, consoleErrors);
      attachConsoleErrorCapture(galaxyPage, consoleErrors);

      await runQaStep(testInfo, '기기전 04 iPad 방 생성 및 대기실 진입', async () => {
        await ipadPage.goto(baseURL);
        await expect(ipadPage.getByTestId('app-shell')).toBeVisible();
        await ipadPage.getByTestId('room-title-input').fill(qaRoomTitle);
        await ipadPage.getByTestId('create-room-button').click();
        await expect(ipadPage.getByTestId('waiting-room')).toBeVisible({ timeout: 25_000 });
        await expect.poll(() => rememberRoomIdByTitle(qaRoomTitle), { message: '생성한 QA 기기 대전 방 ID를 기억해야 합니다.' }).toBeTruthy();
        await saveStepScreenshot(ipadPage, testInfo, '06-device-host-waiting');
      });

      await runQaStep(testInfo, '기기전 05 Galaxy 방 참여 및 준비 버튼 확인', async () => {
        await galaxyPage.goto(baseURL);
        await expect(galaxyPage.getByTestId('app-shell')).toBeVisible();
        const targetRoomCard = galaxyPage.locator('.lobby-room-card').filter({ hasText: qaRoomTitle });
        await expect(targetRoomCard).toBeVisible({ timeout: 15_000 });
        await targetRoomCard.getByRole('button', { name: '참여' }).click();
        const galaxyWaitingRoom = galaxyPage.getByTestId('waiting-room');
        const galaxyReadyCard = galaxyWaitingRoom.locator('.ready-card.me');
        await expect(galaxyWaitingRoom).toBeVisible({ timeout: 25_000 });
        await expect(galaxyReadyCard).toContainText(galaxyNickname, { timeout: 15_000 });
        await expect(galaxyReadyCard).toContainText('나', { timeout: 15_000 });
        await expect(galaxyPage.getByRole('button', { name: '준비 완료' })).toBeEnabled({ timeout: 15_000 });
        await saveStepScreenshot(galaxyPage, testInfo, '07-device-guest-waiting');
      });

      await runQaStep(testInfo, '기기전 06 Galaxy 준비 완료 후 iPad 시작 버튼 확인', async () => {
        await galaxyPage.getByRole('button', { name: '준비 완료' }).click();
        await expect(ipadPage.getByTestId('waiting-room').locator('.ready-card').filter({ hasText: galaxyNickname })).toBeVisible({ timeout: 15_000 });
        await expect(ipadPage.getByTestId('start-game-button')).toBeEnabled({ timeout: 15_000 });
        await ipadPage.getByTestId('start-game-button').click();
      });

      await runQaStep(testInfo, '기기전 07 양쪽 게임 화면 준비 확인', async () => {
        await expectTwoPlayerGameReady(ipadPage, ipadNickname, galaxyNickname);
        await expectTwoPlayerGameReady(galaxyPage, ipadNickname, galaxyNickname);
        await saveStepScreenshot(ipadPage, testInfo, '08-device-host-game');
        await saveStepScreenshot(galaxyPage, testInfo, '09-device-guest-game');
      });

      await runQaStep(testInfo, '기기전 08 한 턴 진행 가능 확인', async () => {
        await waitForAnyRollButtonVisible([ipadPage, galaxyPage]);
        const hostPlayed = await playOneVisibleTurn(ipadPage);
        const guestPlayed = hostPlayed ? false : await playOneVisibleTurn(galaxyPage);
        expect(hostPlayed || guestPlayed, 'iPad 또는 Galaxy 중 현재 턴인 기기가 한 턴을 진행해야 합니다.').toBeTruthy();
        await expect(ipadPage.getByTestId('game-screen')).toBeVisible();
        await expect(galaxyPage.getByTestId('game-screen')).toBeVisible();
      });

      await runQaStep(testInfo, '기기전 09 콘솔 에러 허용 범위 확인', async () => {
        assertConsoleErrorsWithinQaAllowance(consoleErrors);
      });
    } finally {
      await ipadContext.close().catch(() => {});
      await galaxyContext.close().catch(() => {});
      await ipadBrowser.close().catch(() => {});
      await galaxyBrowser.close().catch(() => {});
      await cleanupRememberedRooms();
    }
  });
});
