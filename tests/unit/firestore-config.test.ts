import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_FIRESTORE_DATABASE_ID,
  TARGET_PRODUCTION_FIRESTORE_DATABASE_ID,
  getFirestoreDatabaseId,
} from '../../src/services/firebase/firestoreConfig.js';

test('프로덕션은 named Firestore 데이터베이스를 사용한다', () => {
  assert.equal(getFirestoreDatabaseId(false), TARGET_PRODUCTION_FIRESTORE_DATABASE_ID);
  assert.equal(getFirestoreDatabaseId(false), 'yut-prod-stafor94');
});

test('Firebase emulator는 default 데이터베이스를 유지한다', () => {
  assert.equal(getFirestoreDatabaseId(true), DEFAULT_FIRESTORE_DATABASE_ID);
  assert.equal(getFirestoreDatabaseId(true), '(default)');
});
