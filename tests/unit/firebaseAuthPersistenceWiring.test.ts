import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const firebaseAuthSource = readFileSync('src/services/firebase/firebaseAuth.ts', 'utf8');
const browserAuthTokenSource = readFileSync('tests/helpers/browser-auth-token.js', 'utf8');

test('Firebase Auth는 WebKit reload에서도 anonymous UID를 localStorage 기반으로 복원한다', () => {
  assert.match(firebaseAuthSource, /initializeAuth\(firebaseApp,\s*\{\s*persistence:\s*\[browserLocalPersistence,\s*inMemoryPersistence\]/s);
  assert.doesNotMatch(firebaseAuthSource, /\bgetAuth\(/);
});

test('QA browser auth token helper는 localStorage persistence를 우선 읽고 기존 IndexedDB를 fallback으로 유지한다', () => {
  assert.match(browserAuthTokenSource, /firebase:authUser:/);
  assert.match(browserAuthTokenSource, /storage\.getItem\(key\)/);
  assert.match(browserAuthTokenSource, /indexedDb\.open\('firebaseLocalStorageDb'\)/);
  assert.ok(
    browserAuthTokenSource.indexOf('firebase:authUser:') < browserAuthTokenSource.indexOf("indexedDb.open('firebaseLocalStorageDb')"),
    'localStorage auth token lookup이 IndexedDB fallback보다 먼저 실행되어야 합니다.',
  );
});
