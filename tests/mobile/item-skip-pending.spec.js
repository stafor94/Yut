import { test, expect } from '@playwright/test';
import { collectScreenState, createRoomFromLobby, primeLobbyStorage, runQaStep } from '../helpers/ui.js';
import { hasFirebaseConfig, loadFirebaseConfig, makeQaName, normalizeQaNickname } from '../helpers/env.js';
import { deleteRoomForQa, findRoomIdByTitle, getRoomPlayersForQa, getRoomSequencesForQa, getRoomStateForQa, rememberRoomIdFromPage } from '../helpers/rooms.js';

const ITEM_PROMPT_TIMEOUT_MS = 10_000;

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

const isSkipBeforeSequence = (sequence) => sequence.type === 'item_used'
  && sequence.action?.type === 'use_item'
  && sequence.action?.payload?.skipBeforeRollItem === true;

const isRollSequence = (sequence) => sequence.type === 'roll_yut' || sequence.action?.type === 'roll_yut';

test.describe('mobile item skip pending lock QA', () => {
  let roomId;

  test.afterEach(async () => {
    await deleteRoomForQa(roomId).catch(() => undefined);
  });

  test('before_roll 사용 안 함은 authoritative 확정 전 윷 입력을 한 프레임도 허용하지 않는다', async ({ page, context }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-galaxy', '412×915 mobile-galaxy project에서만 실행합니다.');
    expect(await hasFirebaseConfig(), 'Firebase 설정이 없어 온라인 QA를 실행할 수 없습니다.').toBe(true);
    expect(page.viewportSize()).toEqual({ width: 412, height: 915 });
    const hostName = normalizeQaNickname(makeQaName(testInfo, 'item-skip-host'));
    const roomTitle = makeQaName(testInfo, 'item-skip-room');
    await primeLobbyStorage(context, { nickname: hostName, maxPlayers: '2', playMode: 'individual', itemMode: 'true', stackedRollMode: 'false', pieceCount: '4' });
    await context.addInitScript(() => {
      window.__YUT_QA_TURN_ORDER_RESULT_QUEUE__ = ['모'];
      window.__YUT_QA_AI_TURN_ORDER_RESULT_QUEUE__ = ['도'];
      window.__YUT_QA_DELAY_USE_ITEM_ACTION_MS__ = 1800;
    });

    await runQaStep(testInfo, 'AI 게임을 시작하고 첫 턴 authoritative state를 준비', async () => {
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
      }, { timeout: 40_000, message: '순서 정하기가 끝나 첫 턴 state를 패치할 수 있어야 합니다.' }).toBe(true);
    });

    await runQaStep(testInfo, 'before_roll 아이템 prompt fixture를 state에 반영하고 reload', async () => {
      const [state, players] = await Promise.all([getRoomStateForQa(roomId), getRoomPlayersForQa(roomId)]);
      expect(state, '현재 game state가 필요합니다.').toBeTruthy();
      const hostPlayer = players.find((player) => !player.isAI && player.nickname === hostName) ?? players.find((player) => !player.isAI);
      expect(hostPlayer?.id, '방장 player ID가 필요합니다.').toBeTruthy();
      const turnOrderIds = Array.isArray(state.turnOrderIds) ? state.turnOrderIds : [];
      const hostTurnIndex = turnOrderIds.indexOf(hostPlayer.id);
      expect(hostTurnIndex, '방장이 turn order에 포함되어야 합니다.').toBeGreaterThanOrEqual(0);
      const promptDeadlineAt = Date.now() + ITEM_PROMPT_TIMEOUT_MS;
      await patchRoomStateFromPage(page, roomId, {
        turnIndex: hostTurnIndex,
        roll: null,
        rollStack: [],
        selectedRollStackIndex: null,
        rollStackClosed: false,
        ownedItems: { ...(state.ownedItems ?? {}), [hostPlayer.id]: ['golden_yut'] },
        itemPromptTiming: 'before_roll',
        pendingAfterMoveTurnIndex: null,
        pendingGoldenYutSelection: null,
        pendingTrapPlacement: null,
        lastMovedPieceIds: [],
        lastMovedSeatId: '',
        turnDeadlineAt: promptDeadlineAt,
        turnDeadlineKind: 'item_prompt',
        turnVersion: Number(state.turnVersion ?? 0) + 1,
      });
      await expect.poll(async () => {
        const patchedState = await getRoomStateForQa(roomId);
        return {
          itemPromptTiming: patchedState?.itemPromptTiming ?? null,
          turnDeadlineKind: patchedState?.turnDeadlineKind ?? '',
          turnDeadlineAt: Number(patchedState?.turnDeadlineAt ?? 0),
        };
      }, { timeout: 5_000, message: 'before_roll prompt fixture가 authoritative state에 저장되어야 합니다.' }).toEqual({
        itemPromptTiming: 'before_roll',
        turnDeadlineKind: 'item_prompt',
        turnDeadlineAt: promptDeadlineAt,
      });
      await page.reload();
      await expect(page.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByRole('dialog', { name: '아이템 사용 선택' })).toBeVisible({ timeout: 20_000 });
      await expect(page.getByRole('button', { name: '사용 안 함', exact: true })).toBeEnabled();
    });

    await runQaStep(testInfo, 'skip commit 지연 중 연속 DOM과 sequence를 관찰', async () => {
      const initialSequences = await getRoomSequencesForQa(roomId);
      const initialSkipCount = initialSequences.filter(isSkipBeforeSequence).length;
      const initialRollCount = initialSequences.filter(isRollSequence).length;
      await page.evaluate(() => {
        const result = { enabledRollSeen: false, observationCount: 0 };
        const inspect = () => {
          result.observationCount += 1;
          const rollButton = document.querySelector('[data-testid="roll-yut-button"]');
          if (rollButton instanceof HTMLButtonElement && !rollButton.disabled) result.enabledRollSeen = true;
        };
        const observer = new MutationObserver(inspect);
        observer.observe(document.body, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['disabled'] });
        inspect();
        window.__YUT_QA_ITEM_SKIP_LOCK__ = result;
        window.__YUT_QA_STOP_ITEM_SKIP_LOCK__ = () => observer.disconnect();
      });

      await page.getByRole('button', { name: '사용 안 함', exact: true }).click();
      await expect(page.getByRole('dialog', { name: '아이템 사용 선택' })).toBeHidden({ timeout: 5_000 });
      await expect(page.getByTestId('roll-yut-button')).toBeDisabled({ timeout: 5_000 });
      await page.evaluate(async () => {
        const until = Date.now() + 700;
        while (Date.now() < until) {
          const rollButton = document.querySelector('[data-testid="roll-yut-button"]');
          if (rollButton instanceof HTMLButtonElement) rollButton.click();
          await new Promise((resolve) => window.setTimeout(resolve, 20));
        }
      });

      const pendingSequences = await getRoomSequencesForQa(roomId);
      expect(pendingSequences.filter(isSkipBeforeSequence)).toHaveLength(initialSkipCount);
      expect(pendingSequences.filter(isRollSequence)).toHaveLength(initialRollCount);
      await expect(page.getByTestId('roll-yut-button')).toBeEnabled({ timeout: 15_000 });
      await expect.poll(async () => {
        const sequences = await getRoomSequencesForQa(roomId);
        return {
          skipCount: sequences.filter(isSkipBeforeSequence).length - initialSkipCount,
          rollCount: sequences.filter(isRollSequence).length - initialRollCount,
        };
      }, { timeout: 15_000, message: 'skip은 정확히 한 번 확정되고 roll 요청은 없어야 합니다.' }).toEqual({ skipCount: 1, rollCount: 0 });

      const observed = await page.evaluate(() => {
        window.__YUT_QA_STOP_ITEM_SKIP_LOCK__?.();
        return window.__YUT_QA_ITEM_SKIP_LOCK__;
      });
      expect(observed?.observationCount, 'skip 직후부터 commit 완료까지 DOM 상태를 연속 관찰해야 합니다.').toBeGreaterThan(1);
      expect(observed?.enabledRollSeen, 'authoritative use_item 확정 전 활성 roll 버튼이 나타나면 안 됩니다.').toBe(false);
    });
  });
});
