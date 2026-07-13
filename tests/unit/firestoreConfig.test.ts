import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_FIRESTORE_DATABASE_ID,
  PRODUCTION_FIRESTORE_DATABASE_ID,
  getFirestoreDatabaseId,
} from '../../src/services/firebase/firestoreConfig.js';

test('프로덕션은 yut-prod-stafor94 named database를 사용한다', () => {
  assert.equal(PRODUCTION_FIRESTORE_DATABASE_ID, 'yut-prod-stafor94');
  assert.equal(getFirestoreDatabaseId(false), PRODUCTION_FIRESTORE_DATABASE_ID);
});

test('Firebase emulator QA는 기존 default database를 유지한다', () => {
  assert.equal(getFirestoreDatabaseId(true), DEFAULT_FIRESTORE_DATABASE_ID);
});
