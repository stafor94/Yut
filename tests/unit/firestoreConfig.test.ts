import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  DEFAULT_FIRESTORE_DATABASE_ID,
  PRODUCTION_FIRESTORE_DATABASE_ID,
  TARGET_PRODUCTION_FIRESTORE_DATABASE_ID,
  getFirestoreDatabaseId,
} from '../../src/services/firebase/firestoreConfig.js';

test('프로덕션은 yut-prod-stafor94 named database를 사용한다', () => {
  assert.equal(PRODUCTION_FIRESTORE_DATABASE_ID, TARGET_PRODUCTION_FIRESTORE_DATABASE_ID);
  assert.equal(getFirestoreDatabaseId(false), 'yut-prod-stafor94');
});

test('프로덕션 Firestore 배포 대상도 named database만 유지한다', () => {
  const firebaseConfig = JSON.parse(readFileSync('firebase.json', 'utf8')) as {
    firestore?: Array<{ database?: string }>;
  };
  assert.deepEqual(
    firebaseConfig.firestore?.map(({ database }) => database),
    ['yut-prod-stafor94'],
  );
});

test('Firebase emulator QA는 default database를 유지한다', () => {
  assert.equal(getFirestoreDatabaseId(true), DEFAULT_FIRESTORE_DATABASE_ID);
});
