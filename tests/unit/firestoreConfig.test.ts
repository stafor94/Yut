import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_FIRESTORE_DATABASE_ID,
  PRODUCTION_FIRESTORE_DATABASE_ID,
  TARGET_PRODUCTION_FIRESTORE_DATABASE_ID,
  getFirestoreDatabaseId,
} from '../../src/services/firebase/firestoreConfig.js';

test('프로덕션은 규칙이 적용된 default database를 사용한다', () => {
  assert.equal(PRODUCTION_FIRESTORE_DATABASE_ID, DEFAULT_FIRESTORE_DATABASE_ID);
  assert.equal(getFirestoreDatabaseId(false), DEFAULT_FIRESTORE_DATABASE_ID);
});

test('규칙 배포 후 전환할 named database 식별자를 유지한다', () => {
  assert.equal(TARGET_PRODUCTION_FIRESTORE_DATABASE_ID, 'yut-prod-stafor94');
});

test('Firebase emulator QA도 default database를 유지한다', () => {
  assert.equal(getFirestoreDatabaseId(true), DEFAULT_FIRESTORE_DATABASE_ID);
});
