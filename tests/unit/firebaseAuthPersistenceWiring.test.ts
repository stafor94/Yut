import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const firebaseAuthSource = readFileSync('src/services/firebase/firebaseAuth.ts', 'utf8');
const useAuthSessionSource = readFileSync('src/app/hooks/useAuthSession.ts', 'utf8');
const browserAuthTokenSource = readFileSync('tests/helpers/browser-auth-token.js', 'utf8');
const authoritativeStateFixtureSource = readFileSync('tests/helpers/authoritative-state-fixture.js', 'utf8');

test('Firebase Auth는 WebKit reload에서도 anonymous UID를 localStorage 기반으로 복원한다', () => {
  assert.match(firebaseAuthSource, /initializeAuth\(firebaseApp,\s*\{\s*persistence:\s*\[browserLocalPersistence,\s*inMemoryPersistence\]/s);
  assert.doesNotMatch(firebaseAuthSource, /\bgetAuth\(/);
});

test('후속 null auth 이벤트는 새 UID 대신 같은 Firebase 사용자를 SDK currentUser로 복원한다', () => {
  assert.match(firebaseAuthSource, /updateCurrentUser\(auth,\s*user\)/);
  assert.match(useAuthSessionSource, /restoreUser:\s*restoreAuthUser/);
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

test('authoritative state QA fixture도 공통 browser auth token helper를 사용한다', () => {
  assert.match(authoritativeStateFixtureSource, /import \{ readFirebaseAccessTokenFromIndexedDb \} from '\.\/browser-auth-token\.js';/);
  assert.match(authoritativeStateFixtureSource, /page\.evaluate\(readFirebaseAccessTokenFromIndexedDb\)/);
  assert.doesNotMatch(authoritativeStateFixtureSource, /indexedDB\.open\('firebaseLocalStorageDb'\)/);
});
