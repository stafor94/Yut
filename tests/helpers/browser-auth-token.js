export function findFirebaseAccessToken(value, depth = 0) {
  if (!value || depth > 8) return '';
  if (typeof value === 'string') return value.startsWith('eyJ') && value.split('.').length === 3 ? value : '';
  if (Array.isArray(value)) {
    for (const nested of value) {
      const token = findFirebaseAccessToken(nested, depth + 1);
      if (token) return token;
    }
    return '';
  }
  if (typeof value === 'object') {
    if (typeof value.accessToken === 'string' && value.accessToken.startsWith('eyJ')) return value.accessToken;
    for (const nested of Object.values(value)) {
      const token = findFirebaseAccessToken(nested, depth + 1);
      if (token) return token;
    }
  }
  return '';
}

export function readFirebaseAccessTokenFromIndexedDb(indexedDb) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (database, token = '') => {
      if (settled) return;
      settled = true;
      database?.close();
      resolve(token);
    };

    let request;
    try {
      request = indexedDb.open('firebaseLocalStorageDb');
    } catch {
      finish(null);
      return;
    }
    request.onerror = () => finish(null);
    request.onsuccess = () => {
      const database = request.result;
      const stores = Array.from(database.objectStoreNames);
      if (!stores.length) {
        finish(database);
        return;
      }

      let transaction;
      try {
        transaction = database.transaction(stores, 'readonly');
      } catch {
        finish(database);
        return;
      }

      const storedValues = [];
      let requestFailed = false;
      for (const storeName of stores) {
        let getAllRequest;
        try {
          getAllRequest = transaction.objectStore(storeName).getAll();
        } catch {
          requestFailed = true;
          continue;
        }
        getAllRequest.onerror = () => {
          requestFailed = true;
        };
        getAllRequest.onsuccess = () => {
          storedValues.push(getAllRequest.result);
        };
      }

      transaction.onerror = () => {
        requestFailed = true;
      };
      transaction.onabort = () => finish(database);
      transaction.oncomplete = () => finish(
        database,
        requestFailed ? '' : findFirebaseAccessToken(storedValues),
      );
    };
  });
}
