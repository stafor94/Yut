import { readFirebaseAccessTokenFromIndexedDb } from './browser-auth-token.js';
import { loadFirebaseConfig } from './env.js';

function decodeFirestoreValue(value) {
  if (!value || typeof value !== 'object') return null;
  if ('nullValue' in value) return null;
  if ('booleanValue' in value) return value.booleanValue;
  if ('stringValue' in value) return value.stringValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return Number(value.doubleValue);
  if ('timestampValue' in value) return new Date(value.timestampValue);
  if ('arrayValue' in value) return (value.arrayValue?.values ?? []).map(decodeFirestoreValue);
  if ('mapValue' in value) {
    return Object.fromEntries(
      Object.entries(value.mapValue?.fields ?? {}).map(([key, entry]) => [key, decodeFirestoreValue(entry)]),
    );
  }
  return null;
}

function encodeFirestoreValue(value) {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'number') {
    return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  }
  if (value instanceof Date) return { timestampValue: value.toISOString() };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encodeFirestoreValue) } };
  if (typeof value === 'object') {
    return {
      mapValue: {
        fields: Object.fromEntries(
          Object.entries(value).map(([key, entry]) => [key, encodeFirestoreValue(entry)]),
        ),
      },
    };
  }
  throw new Error(`지원하지 않는 Firestore fixture 값입니다: ${typeof value}`);
}

function getStateDocumentUrl(projectId, roomId) {
  const emulatorEndpoint = String(process.env.FIRESTORE_EMULATOR_HOST ?? '').trim();
  const origin = emulatorEndpoint ? `http://${emulatorEndpoint}` : 'https://firestore.googleapis.com';
  return `${origin}/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents/rooms/${encodeURIComponent(roomId)}/state/current`;
}

async function firestoreRequest(url, accessToken, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers ?? {}),
    },
  });
  if (!response.ok) {
    throw new Error(`Firestore fixture ${options.method ?? 'GET'} ${response.status}: ${await response.text()}`);
  }
  return response.json();
}

export async function seedRoomPieceAtNodeForQa({
  roomId,
  authPage,
  ownerSeatId,
  pieceId,
  nodeId,
  previousNodeId = '',
  turnDeadlineAt = 0,
}) {
  const config = await loadFirebaseConfig();
  if (!config?.projectId) throw new Error('Firebase projectId가 없어 room state fixture를 준비할 수 없습니다.');
  const accessToken = await authPage.evaluate(readFirebaseAccessTokenFromIndexedDb);
  if (!accessToken) throw new Error('방 참가자의 Firebase access token을 읽지 못했습니다.');

  const stateUrl = getStateDocumentUrl(config.projectId, roomId);
  const document = await firestoreRequest(stateUrl, accessToken);
  const fields = document.fields ?? {};
  const pieces = decodeFirestoreValue(fields.pieces);
  if (!Array.isArray(pieces)) throw new Error('현재 room state에 pieces 배열이 없습니다.');
  const targetIndex = pieces.findIndex((piece) => piece?.id === pieceId && piece?.ownerId === ownerSeatId);
  if (targetIndex < 0) throw new Error(`fixture 대상 말을 찾지 못했습니다: ${pieceId}`);

  pieces[targetIndex] = {
    ...pieces[targetIndex],
    nodeId,
    nodeIndex: Math.max(0, Number.parseInt(nodeId.replace(/^n/u, ''), 10) - 1),
    previousNodeId,
    started: true,
    finished: false,
  };
  const currentTurnVersion = Number(decodeFirestoreValue(fields.turnVersion) ?? 0);
  const nextTurnDeadlineAt = Number(turnDeadlineAt);
  const shouldUpdateTurnDeadline = Number.isFinite(nextTurnDeadlineAt) && nextTurnDeadlineAt > 0;
  const patchUrl = new URL(stateUrl);
  patchUrl.searchParams.append('updateMask.fieldPaths', 'pieces');
  patchUrl.searchParams.append('updateMask.fieldPaths', 'turnVersion');
  if (shouldUpdateTurnDeadline) patchUrl.searchParams.append('updateMask.fieldPaths', 'turnDeadlineAt');
  await firestoreRequest(patchUrl.toString(), accessToken, {
    method: 'PATCH',
    body: JSON.stringify({
      fields: {
        pieces: encodeFirestoreValue(pieces),
        turnVersion: encodeFirestoreValue(currentTurnVersion + 1),
        ...(shouldUpdateTurnDeadline ? { turnDeadlineAt: encodeFirestoreValue(nextTurnDeadlineAt) } : {}),
      },
    }),
  });
}
