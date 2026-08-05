import { loadFirebaseConfig } from './env.js';
import { getRoomStateForQa } from './rooms.js';

const SEQUENCE_ID_PAD_LENGTH = 12;
const FIXTURE_COMMIT_RETRY_LIMIT = 3;

const encodeFirestoreValue = (value) => {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'number') return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encodeFirestoreValue) } };
  if (typeof value === 'object') return { mapValue: { fields: Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, encodeFirestoreValue(nested)])) } };
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

const getFirestoreDocumentName = (projectId, pathSegments) => `projects/${projectId}/databases/(default)/documents/${pathSegments.join('/')}`;
const makeSequenceDocId = (sequence) => String(sequence).padStart(SEQUENCE_ID_PAD_LENGTH, '0');
const isRetryableFixtureCommitFailure = (status, responseText) => (status === 400 || status === 409) && /(ABORTED|ALREADY_EXISTS|FAILED_PRECONDITION)/u.test(responseText);

export async function commitAuthoritativeStatePatchForQa(page, roomId, patch, actorId, {
  fixtureName,
  errorLabel,
  accessToken = '',
}) {
  const config = await loadFirebaseConfig();
  if (!config?.projectId) throw new Error(`Firebase projectId가 없어 ${errorLabel}를 설정할 수 없습니다.`);
  const resolvedAccessToken = accessToken || await readFirebaseAccessTokenFromPage(page);
  if (!resolvedAccessToken) throw new Error('게임 호스트 Firebase access token을 찾지 못했습니다.');
  const commitUrl = `${getFirestoreDocumentsBaseUrl(config.projectId)}:commit`;

  for (let attempt = 0; attempt < FIXTURE_COMMIT_RETRY_LIMIT; attempt += 1) {
    const state = await getRoomStateForQa(roomId);
    if (!state) throw new Error(`${errorLabel} commit을 위한 authoritative state가 없습니다.`);
    const currentSequence = Number(state.lastSequence ?? 0);
    const currentTurnVersion = Number(state.turnVersion ?? 0);
    const nextSequence = currentSequence + 1;
    const nextTurnVersion = currentTurnVersion + 1;
    const committedAt = Date.now();
    const clientMutationId = `qa-${fixtureName}:${roomId}:${nextSequence}`;
    const sequenceFields = {
      sequence: encodeFirestoreValue(nextSequence),
      type: encodeFirestoreValue('state_snapshot'),
      actorId: encodeFirestoreValue(actorId || 'qa-system'),
      payload: encodeFirestoreValue({ qaFixture: fixtureName }),
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
    const stateFieldPaths = [...new Set([...Object.keys(patch), 'turnVersion', 'lastSequence', 'lastClientMutationId', 'updatedAt'])];

    const response = await fetch(commitUrl, {
      method: 'POST',
      headers: { Authorization: `Bearer ${resolvedAccessToken}`, 'Content-Type': 'application/json' },
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
    if (response.ok) return { clientMutationId, lastSequence: nextSequence, turnVersion: nextTurnVersion };
    if (attempt + 1 < FIXTURE_COMMIT_RETRY_LIMIT && isRetryableFixtureCommitFailure(response.status, responseText)) continue;
    throw new Error(`${errorLabel} sequence commit ${response.status}: ${responseText}`);
  }
  throw new Error(`${errorLabel} sequence commit 재시도 한도를 초과했습니다.`);
}
