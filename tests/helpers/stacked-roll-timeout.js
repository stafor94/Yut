import { expect } from '@playwright/test';
import { loadFirebaseConfig, makeQaName, normalizeQaNickname } from './env.js';
import {
  createRoomFromLobby,
  collectScreenState,
  primeLobbyStorage,
  primeTurnOrderResultQueues,
} from './ui.js';
import {
  findRoomIdByTitle,
  getRoomSequencesForQa,
  getRoomStateForQa,
  rememberRoomIdFromPage,
} from './rooms.js';

const encodeFirestoreValue = (value) => {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'number') return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encodeFirestoreValue) } };
  if (typeof value === 'object') {
    return { mapValue: { fields: Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, encodeFirestoreValue(nested)])) } };
  }
  throw new Error(`지원하지 않는 Firestore 값입니다: ${typeof value}`);
};

const readFirebaseAccessTokenFromPage = (page) => page.evaluate(async () => {
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
        getAllRequest.onerror = () => {
          pending -= 1;
          if (!resolved && pending === 0) {
            database.close();
            resolve('');
          }
        };
        getAllRequest.onsuccess = () => {
          const token = findToken(getAllRequest.result);
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
      }
    };
  });
});

const getFirestoreDocumentUrl = (projectId, pathSegments) => {
  const encodedPath = pathSegments.map((segment) => encodeURIComponent(segment)).join('/');
  const emulatorEndpoint = String(process.env.FIRESTORE_EMULATOR_HOST ?? '').trim();
  if (emulatorEndpoint) {
    const [host, port] = emulatorEndpoint.split(':');
    return `http://${host}:${port}/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents/${encodedPath}`;
  }
  return `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents/${encodedPath}`;
};

async function patchRoomStateForQa(page, roomId, patch) {
  const config = await loadFirebaseConfig();
  if (!config?.projectId) throw new Error('Firebase projectId가 없어 stacked timeout fixture를 설정할 수 없습니다.');
  const accessToken = await readFirebaseAccessTokenFromPage(page);
  if (!accessToken) throw new Error('게임 호스트 Firebase access token을 찾지 못했습니다.');
  const url = new URL(getFirestoreDocumentUrl(config.projectId, ['rooms', roomId, 'state', 'current']));
  Object.keys(patch).forEach((fieldPath) => url.searchParams.append('updateMask.fieldPaths', fieldPath));
  const fields = Object.fromEntries(Object.entries(patch).map(([key, value]) => [key, encodeFirestoreValue(value)]));
  const response = await fetch(url, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ fields }),
  });
  if (!response.ok) throw new Error(`stacked timeout state PATCH ${response.status}: ${await response.text()}`);
}

const getRecoverySequences = (sequences, actionKey) => sequences.filter((sequence) => (
  sequence.type === 'move_piece_resolved'
  && sequence.action?.type === 'move_piece'
  && sequence.action?.payload?.clientActionId === actionKey
));

const hasClientAppliedAuthoritativeState = (screen, state) => {
  const debug = screen.yutDebug;
  const syncPipeline = debug?.syncPipeline;
  const stateVersion = Number(state?.turnVersion ?? 0);
  const sequence = Number(state?.lastSequence ?? 0);
  return Boolean(
    debug
    && syncPipeline
    && stateVersion > 0
    && sequence > 0
    && Number(debug.lastAppliedStateVersion ?? 0) === stateVersion
    && Number(debug.lastAppliedSequence ?? 0) === sequence
    && syncPipeline.applyingSyncedState === false
    && syncPipeline.sequenceReplayInProgress === false
    && syncPipeline.onlineAuthoritativeGameStatePending === false
    && syncPipeline.authoritativeGameStateReady === true,
  );
};

export async function prepareStackedRollTimeoutFixture({ page, context, testInfo }) {
  const hostName = normalizeQaNickname(makeQaName(testInfo, 'stackhost'));
  const roomTitle = makeQaName(testInfo, 'stack-timeout-room');
  await primeLobbyStorage(context, {
    nickname: hostName,
    maxPlayers: '2',
    playMode: 'individual',
    itemMode: 'false',
    pieceCount: '4',
  });
  await context.addInitScript(() => {
    window.localStorage.setItem('yut-online:stackedRollMode', 'true');
  });
  await primeTurnOrderResultQueues(context, { human: ['모'], ai: ['도'] });
  await createRoomFromLobby(page, roomTitle);
  await expect(page.getByTestId('waiting-room')).toBeVisible({ timeout: 25_000 });
  const roomId = await rememberRoomIdFromPage(page) ?? await findRoomIdByTitle(roomTitle);
  if (!roomId) throw new Error('stacked timeout QA 방 ID를 찾지 못했습니다.');

  const addAiButton = page.getByTestId('add-ai-P2');
  if (await addAiButton.isVisible().catch(() => false)) await addAiButton.click();
  await expect(page.getByTestId('start-game-button')).toBeEnabled({ timeout: 15_000 });
  await page.getByTestId('start-game-button').click();
  await expect(page.getByTestId('game-screen')).toBeVisible({ timeout: 35_000 });
  await expect.poll(async () => {
    const screen = await collectScreenState(page);
    return Boolean(
      !screen.yutDebug?.turnOrderPhase?.active
      && !screen.yutDebug?.turnOrderIntro
      && Array.isArray(screen.yutDebug?.turnOrderIds)
      && screen.yutDebug.turnOrderIds.length >= 2,
    );
  }, { timeout: 40_000, message: '순서 정하기 완료 후 stacked timeout fixture를 주입해야 합니다.' }).toBe(true);

  let state = null;
  await expect.poll(async () => {
    const authoritativeState = await getRoomStateForQa(roomId);
    if (!authoritativeState
      || !Array.isArray(authoritativeState.turnOrderIds)
      || !authoritativeState.turnOrderIds.length
      || !authoritativeState.coordinatorSeatId
      || Number(authoritativeState.coordinatorEpoch ?? 0) <= 0) return false;
    const screen = await collectScreenState(page);
    if (!hasClientAppliedAuthoritativeState(screen, authoritativeState)) return false;
    state = authoritativeState;
    return true;
  }, {
    timeout: 30_000,
    intervals: [50, 100, 200, 400],
    message: 'sequence replay와 authoritative snapshot 적용이 모두 끝난 뒤 stacked timeout fixture를 주입해야 합니다.',
  }).toBe(true);
  if (!state) throw new Error('동기화가 완료된 authoritative game state가 없습니다.');

  const actorId = String(state.coordinatorSeatId ?? state.turnOrderIds?.[0] ?? '');
  const actorTurnIndex = Math.max(0, state.turnOrderIds.findIndex((seatId) => seatId === actorId));
  const fixtureTurnVersion = Math.max(1, Number(state.turnVersion ?? 0) + 1);
  const expiredTurnVersion = fixtureTurnVersion + 1;
  const fixtureSequence = Number(state.lastSequence ?? 0);
  const visibleDeadlineAt = Date.now() + 60_000;
  await patchRoomStateForQa(page, roomId, {
    turnVersion: fixtureTurnVersion,
    turnIndex: actorTurnIndex,
    roll: null,
    rollStack: [
      { name: '도', steps: 1 },
      { name: '걸', steps: 3 },
    ],
    selectedRollStackIndex: null,
    rollStackClosed: true,
    rollAnimation: null,
    rollResultReadyAt: 0,
    pendingGoldenYutSelection: null,
    pendingTrapPlacement: null,
    pendingItemPickup: null,
    itemPromptTiming: null,
    branchChoice: 'outer',
    turnDeadlineKind: 'move',
    turnDeadlineAt: visibleDeadlineAt,
    turnActionTimeoutCountBySeatId: { [actorId]: 0 },
    autoPlayBySeatId: { [actorId]: false },
  });

  await expect.poll(async () => {
    const current = await getRoomStateForQa(roomId);
    const currentStack = Array.isArray(current?.rollStack) ? current.rollStack : [];
    return Boolean(
      current
      && Number(current.turnVersion) === fixtureTurnVersion
      && Number(current.lastSequence ?? 0) === fixtureSequence
      && Number(current.turnIndex) === actorTurnIndex
      && current.roll === null
      && current.selectedRollStackIndex === null
      && current.rollStackClosed === true
      && current.turnDeadlineKind === 'move'
      && Number(current.turnDeadlineAt) === visibleDeadlineAt
      && currentStack.length === 2
      && currentStack[0]?.name === '도'
      && Number(currentStack[0]?.steps) === 1
      && currentStack[1]?.name === '걸'
      && Number(currentStack[1]?.steps) === 3,
    );
  }, {
    timeout: 10_000,
    intervals: [50, 100, 200, 400],
    message: '닫힌 다중 미선택 이동 스택 fixture가 authoritative state에 안정적으로 반영되어야 합니다.',
  }).toBe(true);

  await expect.poll(async () => {
    const screen = await collectScreenState(page);
    const debug = screen.yutDebug;
    const syncPipeline = debug?.syncPipeline;
    return Boolean(
      debug
      && syncPipeline
      && Number(debug.lastAppliedStateVersion ?? 0) === fixtureTurnVersion
      && Number(debug.lastAppliedSequence ?? 0) === fixtureSequence
      && debug.roll === null
      && debug.turnDeadlineKind === 'move'
      && Number(debug.turnDeadlineAt ?? 0) === visibleDeadlineAt
      && syncPipeline.applyingSyncedState === false
      && syncPipeline.sequenceReplayInProgress === false,
    );
  }, {
    timeout: 10_000,
    intervals: [50, 100, 200, 400],
    message: '클라이언트가 stacked timeout fixture snapshot을 실제로 적용해야 합니다.',
  }).toBe(true);

  const picker = page.locator('.roll-stack-picker');
  await expect(picker).toBeVisible({ timeout: 10_000 });
  await expect(picker.getByRole('button')).toHaveCount(2);
  await expect(picker.getByRole('button').first()).toBeEnabled();

  const timeoutDeadlineAt = Date.now() - 1;
  const actionKey = `timeout:${roomId}:move:${actorId}:${timeoutDeadlineAt}`;
  const baselineSequences = await getRoomSequencesForQa(roomId);
  await patchRoomStateForQa(page, roomId, {
    turnVersion: expiredTurnVersion,
    turnDeadlineAt: timeoutDeadlineAt,
  });
  await expect.poll(async () => {
    const buttons = picker.getByRole('button');
    const buttonCount = await buttons.count();
    if (buttonCount === 0) return true;
    return buttons.evaluateAll((entries) => entries.length === 2 && entries.every((button) => button.disabled));
  }, {
    timeout: 900,
    intervals: [25, 50, 100],
    message: 'deadline 이후 일반 스택 선택 버튼은 다시 활성화되지 않아야 합니다.',
  }).toBe(true);

  return {
    actionKey,
    actorId,
    baselineSequenceCount: baselineSequences.length,
    roomId,
    timeoutDeadlineAt,
  };
}

export async function waitForStackedRollTimeoutRecovery({ actionKey, actorId, roomId, timeoutDeadlineAt }) {
  const recovery = await expect.poll(async () => {
    const sequences = await getRoomSequencesForQa(roomId);
    const matching = getRecoverySequences(sequences, actionKey);
    const state = await getRoomStateForQa(roomId);
    if (matching.length !== 1 || !state) return null;
    const action = matching[0].action;
    const remainingStack = Array.isArray(state.rollStack) ? state.rollStack : [];
    if (remainingStack.length !== 1) return null;
    return {
      action,
      matchingCount: matching.length,
      remainingStack,
      state,
    };
  }, { timeout: 15_000, intervals: [100, 200, 400, 800], message: 'deadline+network grace 이후 0번 스택 recovery sequence가 정확히 한 번 생성되어야 합니다.' }).not.toBeNull();
  void recovery;

  const sequences = await getRoomSequencesForQa(roomId);
  const matching = getRecoverySequences(sequences, actionKey);
  const state = await getRoomStateForQa(roomId);
  expect(matching).toHaveLength(1);
  expect(matching[0].action?.payload).toMatchObject({
    recoveredByCoordinator: true,
    rollStackIndex: 0,
    timeoutDeadlineAt,
  });
  expect(state?.rollStack).toEqual([{ name: '걸', steps: 3 }]);
  expect(state?.turnActionTimeoutCountBySeatId?.[actorId]).toBe(1);
  expect(state?.turnDeadlineAt).not.toBe(timeoutDeadlineAt);

  const duplicateCheckAt = Date.now() + 1_600;
  await expect.poll(async () => {
    if (Date.now() < duplicateCheckAt) return null;
    const nextSequences = await getRoomSequencesForQa(roomId);
    return getRecoverySequences(nextSequences, actionKey).length;
  }, { timeout: 3_000, intervals: [100, 200, 400], message: '추가 대기 후에도 같은 timeout recovery가 중복 생성되면 안 됩니다.' }).toBe(1);

  return { sequence: matching[0], state };
}
