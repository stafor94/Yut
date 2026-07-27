import { loadFirebaseConfig } from './env.js';

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

export async function patchRoomStateFromPage(page, roomId, patch) {
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
