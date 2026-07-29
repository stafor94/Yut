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

const SEQUENCE_ID_PAD_LENGTH = 12;
const FIXTURE_COMMIT_RETRY_LIMIT = 3;
const ACTION_WAIT_TIMEOUT_MS = 35_000;

const DO = Object.freeze({ name: '도', steps: 1 });
const GAE = Object.freeze({ name: '개', steps: 2 });

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

const getFirestoreDocumentsBaseUrl = (projectId) => {
  const emulatorEndpoint = String(process.env.FIRESTORE_EMULATOR_HOST ?? '').trim();
  if (emulatorEndpoint) {
    const [host, port] = emulatorEndpoint.split(':');
    return `http://${host}:${port}/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents`;
  }
  return `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents`;
};

const getFirestoreDocumentName = (projectId, pathSegments) => (
  `projects/${projectId}/databases/(default)/documents/${pathSegments.join('/')}`
);

const makeSequenceDocId = (sequence) => String(sequence).padStart(SEQUENCE_ID_PAD_LENGTH, '0');

const isRetryableFixtureCommitFailure = (status, responseText) => (
  (status === 400 || status === 409)
  && /(ABORTED|ALREADY_EXISTS|FAILED_PRECONDITION)/u.test(responseText)
);

async function commitRoomStatePatchForQa(page, roomId, patch, actorId) {
  const config = await loadFirebaseConfig();
  if (!config?.projectId) throw new Error('Firebase projectId가 없어 hard AI stacked fixture를 설정할 수 없습니다.');
  const accessToken = await readFirebaseAccessTokenFromPage(page);
  if (!accessToken) throw new Error('게임 호스트 Firebase access token을 찾지 못했습니다.');
  const commitUrl = `${getFirestoreDocumentsBaseUrl(config.projectId)}:commit`;

  for (let attempt = 0; attempt < FIXTURE_COMMIT_RETRY_LIMIT; attempt += 1) {
    const state = await getRoomStateForQa(roomId);
    if (!state) throw new Error('hard AI stacked fixture commit을 위한 authoritative state가 없습니다.');
    const currentSequence = Number(state.lastSequence ?? 0);
    const currentTurnVersion = Number(state.turnVersion ?? 0);
    const nextSequence = currentSequence + 1;
    const nextTurnVersion = currentTurnVersion + 1;
    const committedAt = Date.now();
    const clientMutationId = `qa-hard-ai-stacked-fixture:${roomId}:${nextSequence}`;
    const sequenceFields = {
      sequence: encodeFirestoreValue(nextSequence),
      type: encodeFirestoreValue('state_snapshot'),
      actorId: encodeFirestoreValue(actorId || 'qa-system'),
      payload: encodeFirestoreValue({ qaFixture: 'hard-ai-stacked-strategy' }),
      schemaVersion: encodeFirestoreValue(2),
      eventSchemaVersion: encodeFirestoreValue(2),
      action: encodeFirestoreValue(null),
      patch: encodeFirestoreValue(patch),
      logEntries: encodeFirestoreValue([]),
      expectedPreviousSequence: encodeFirestoreValue(currentSequence),
      clientMutationId: encodeFirestoreValue(clientMutationId),
      clientCreatedAt: encodeFirestoreValue(committedAt),
      createdAt: { timestampValue: new Date(committedAt).toISOString() },
    };
    if (state.coordinatorSeatId) sequenceFields.coordinatorSeatId = encodeFirestoreValue(state.coordinatorSeatId);
    if (Number(state.coordinatorEpoch ?? 0) > 0) sequenceFields.coordinatorEpoch = encodeFirestoreValue(Number(state.coordinatorEpoch));

    const stateFields = Object.fromEntries(Object.entries(patch).map(([key, value]) => [key, encodeFirestoreValue(value)]));
    stateFields.turnVersion = encodeFirestoreValue(nextTurnVersion);
    stateFields.lastSequence = encodeFirestoreValue(nextSequence);
    stateFields.lastClientMutationId = encodeFirestoreValue(clientMutationId);
    stateFields.updatedAt = { timestampValue: new Date(committedAt).toISOString() };
    const stateFieldPaths = [...new Set([
      ...Object.keys(patch),
      'turnVersion',
      'lastSequence',
      'lastClientMutationId',
      'updatedAt',
    ])];

    const response = await fetch(commitUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        writes: [
          {
            update: {
              name: getFirestoreDocumentName(config.projectId, ['rooms', roomId, 'sequences', makeSequenceDocId(nextSequence)]),
              fields: sequenceFields,
            },
            currentDocument: { exists: false },
          },
          {
            update: {
              name: getFirestoreDocumentName(config.projectId, ['rooms', roomId, 'state', 'current']),
              fields: stateFields,
            },
            updateMask: { fieldPaths: stateFieldPaths },
          },
        ],
      }),
    });
    const responseText = await response.text();
    if (response.ok) return { lastSequence: nextSequence, turnVersion: nextTurnVersion };
    if (attempt + 1 < FIXTURE_COMMIT_RETRY_LIMIT && isRetryableFixtureCommitFailure(response.status, responseText)) continue;
    throw new Error(`hard AI stacked fixture commit ${response.status}: ${responseText}`);
  }
  throw new Error('hard AI stacked fixture commit 재시도 한도를 초과했습니다.');
}

const getHardAiMoveSequences = (sequences, fixtureSequence, aiSeatId) => sequences
  .filter((sequence) => (
    Number(sequence.sequence ?? 0) > fixtureSequence
    && sequence.type === 'move_piece_resolved'
    && sequence.actorId === aiSeatId
    && sequence.action?.type === 'move_piece'
    && String(sequence.action?.payload?.clientActionId ?? '').startsWith('move_piece_ai:')
  ))
  .sort((left, right) => Number(left.sequence ?? 0) - Number(right.sequence ?? 0));

const findPieceNodeInPatch = (sequence, pieceId) => (
  Array.isArray(sequence?.patch?.pieces)
    ? sequence.patch.pieces.find((piece) => piece?.id === pieceId)?.nodeId
    : undefined
);

export async function prepareHardAiStackedStrategyFixture({ page, context, testInfo }) {
  const hostName = normalizeQaNickname(makeQaName(testInfo, 'hard-ai-host'));
  const roomTitle = makeQaName(testInfo, 'hard-ai-stacked-room');
  await primeLobbyStorage(context, {
    nickname: hostName,
    maxPlayers: '2',
    playMode: 'individual',
    itemMode: 'false',
    pieceCount: '2',
  });
  await context.addInitScript(() => {
    window.localStorage.setItem('yut-online:stackedRollMode', 'true');
  });
  await primeTurnOrderResultQueues(context, { human: ['모'], ai: ['도'] });
  await createRoomFromLobby(page, roomTitle);
  await expect(page.getByTestId('waiting-room')).toBeVisible({ timeout: 25_000 });
  const roomId = await rememberRoomIdFromPage(page) ?? await findRoomIdByTitle(roomTitle);
  if (!roomId) throw new Error('hard AI stacked QA 방 ID를 찾지 못했습니다.');

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
  }, { timeout: 40_000, message: '순서 정하기 완료 후 hard AI stacked fixture를 주입해야 합니다.' }).toBe(true);

  await expect.poll(async () => {
    const current = await getRoomStateForQa(roomId);
    if (!current || !Array.isArray(current.turnOrderIds) || !Array.isArray(current.pieces)) return false;
    if (!current.coordinatorSeatId || Number(current.coordinatorEpoch ?? 0) <= 0) return false;
    const aiSeat = (current.gameSeats ?? []).find((seat) => seat?.isAI === true || seat?.isSubstitutedByAI === true);
    return Boolean(aiSeat?.id);
  }, { timeout: 20_000, message: 'authoritative hard AI seat와 coordinator lease가 준비되어야 합니다.' }).toBe(true);

  const readyState = await getRoomStateForQa(roomId);
  if (!readyState) throw new Error('authoritative game state가 없습니다.');
  const aiSeat = (readyState.gameSeats ?? []).find((seat) => seat?.isAI === true || seat?.isSubstitutedByAI === true);
  const aiSeatId = String(aiSeat?.id ?? '');
  if (!aiSeatId) throw new Error('hard AI seat ID를 찾지 못했습니다.');
  const aiTurnIndex = readyState.turnOrderIds.findIndex((seatId) => seatId === aiSeatId);
  if (aiTurnIndex < 0) throw new Error('turnOrderIds에 hard AI seat가 없습니다.');

  let strategicPieceId = '';
  const patchedPieces = readyState.pieces.map((piece) => {
    if (piece.ownerId !== aiSeatId) {
      return { ...piece, nodeIndex: 0, nodeId: 'n01', started: false, finished: false, previousNodeId: null };
    }
    if (!strategicPieceId) {
      strategicPieceId = String(piece.id);
      return { ...piece, nodeIndex: 3, nodeId: 'n04', started: true, finished: false, previousNodeId: 'n03' };
    }
    return { ...piece, nodeIndex: 0, nodeId: 'n01', started: false, finished: false, previousNodeId: null };
  });
  if (!strategicPieceId) throw new Error('hard AI 전략 말 ID를 찾지 못했습니다.');

  const fixture = await commitRoomStatePatchForQa(page, roomId, {
    pieces: patchedPieces,
    turnIndex: aiTurnIndex,
    roll: null,
    rollStack: [DO, GAE],
    selectedRollStackIndex: null,
    rollStackClosed: true,
    boardItems: [],
    trapNodes: [],
    shieldedPieceIds: [],
    winner: '',
    pendingGoldenYutSelection: null,
    pendingTrapPlacement: null,
    pendingItemPickup: null,
    itemPromptTiming: null,
    pendingAfterMoveTurnIndex: null,
    branchChoice: 'outer',
    rollResultReadyAt: 0,
    turnDeadlineKind: 'move',
    turnDeadlineAt: Date.now() + 30_000,
    turnActionTimeoutCountBySeatId: { ...(readyState.turnActionTimeoutCountBySeatId ?? {}), [aiSeatId]: 0 },
    autoPlayBySeatId: { ...(readyState.autoPlayBySeatId ?? {}), [aiSeatId]: false },
  }, aiSeatId);

  return { aiSeatId, fixtureSequence: fixture.lastSequence, roomId, strategicPieceId };
}

export async function waitForHardAiStackedStrategy({ aiSeatId, fixtureSequence, roomId, strategicPieceId }) {
  await expect.poll(async () => {
    const sequences = await getRoomSequencesForQa(roomId);
    const moves = getHardAiMoveSequences(sequences, fixtureSequence, aiSeatId);
    const state = await getRoomStateForQa(roomId);
    const strategicPiece = state?.pieces?.find((piece) => piece?.id === strategicPieceId);
    return moves.length >= 2 && strategicPiece?.nodeId === 'd05';
  }, {
    timeout: ACTION_WAIT_TIMEOUT_MS,
    intervals: [100, 200, 400, 800],
    message: 'hard AI가 개→n06, 도→shortcut 순서의 authoritative action을 완료해야 합니다.',
  }).toBe(true);

  const sequences = await getRoomSequencesForQa(roomId);
  const moves = getHardAiMoveSequences(sequences, fixtureSequence, aiSeatId);
  const state = await getRoomStateForQa(roomId);
  expect(moves).toHaveLength(2);
  const [firstMove, secondMove] = moves;
  expect(firstMove.action?.payload).toMatchObject({
    pieceId: strategicPieceId,
    roll: GAE,
    rollStackIndex: 1,
    branchChoice: 'outer',
  });
  expect(findPieceNodeInPatch(firstMove, strategicPieceId)).toBe('n06');
  expect(secondMove.action?.payload).toMatchObject({
    pieceId: strategicPieceId,
    roll: DO,
    rollStackIndex: 0,
    branchChoice: 'shortcut',
  });
  expect(findPieceNodeInPatch(secondMove, strategicPieceId)).toBe('d05');
  expect(state?.pieces?.find((piece) => piece?.id === strategicPieceId)?.nodeId).toBe('d05');
  expect(Array.isArray(state?.rollStack) ? state.rollStack : []).toHaveLength(0);
  expect(state?.pendingTrapPlacement ?? null).toBeNull();
  expect(state?.pendingItemPickup ?? null).toBeNull();
  return { firstMove, secondMove, state };
}
