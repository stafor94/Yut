import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const rules = readFileSync('firestore.rules', 'utf8');

test('일반 방 하위 컬렉션은 공통 정책을 자동 적용한다', () => {
  assert.match(rules, /function requiresExplicitRoomDataRule\(collectionId\)/);
  assert.match(rules, /function canReadStandardRoomData\(roomId, collectionId\)/);
  assert.match(rules, /function canWriteStandardRoomData\(roomId, collectionId\)/);
  assert.match(rules, /function canDeleteStandardRoomData\(roomId, collectionId\)/);
  assert.match(rules, /match \/\{collectionId\}\/\{documentId\}/);
  assert.match(rules, /allow read: if canReadStandardRoomData\(roomId, collectionId\)/);
  assert.match(rules, /allow create, update: if canWriteStandardRoomData\(roomId, collectionId\)/);
  assert.match(rules, /allow delete: if canDeleteStandardRoomData\(roomId, collectionId\)/);
});

test('기존 일반 컬렉션의 권한 차이는 공통 정책에서 보존한다', () => {
  assert.match(rules, /collectionId == 'seats'[\s\S]*\? signedIn\(\)[\s\S]*: canReadRoomData\(roomId\)/);
  assert.match(rules, /collectionId in \['seats', 'state'\][\s\S]*isPresenceCleanupLeaseOwner\(roomId\)/);

  for (const collectionId of ['seats', 'state', 'processedActions', 'boardItems']) {
    assert.doesNotMatch(rules, new RegExp(`match /${collectionId}/`));
  }
  assert.doesNotMatch(rules, /match \/rooms\/\{nestedRoomId\}/);
});

test('신원·스키마 검사가 필요한 컬렉션은 공통 정책에서 제외한다', () => {
  const explicitCollections = ['players', 'actions', 'sequences', 'turnOrderSubmissions'];
  const explicitPolicy = rules.match(/function requiresExplicitRoomDataRule\(collectionId\) \{([\s\S]*?)\n    \}/)?.[1] ?? '';

  for (const collectionId of explicitCollections) {
    assert.match(explicitPolicy, new RegExp(`'${collectionId}'`));
    assert.match(rules, new RegExp(`match /${collectionId}/`));
  }

  assert.match(rules, /request\.resource\.data\.seatId == request\.auth\.uid/);
  assert.match(rules, /request\.resource\.data\.submissionId == submissionId/);
  assert.match(rules, /allow update: if false/);
});

test('알 수 없는 최상위·깊은 중첩 경로는 계속 거부한다', () => {
  const denyAllMatches = rules.match(/match \/\{document=\*\*\} \{\s*allow read, write: if false;\s*\}/g) ?? [];
  assert.equal(denyAllMatches.length, 2);
});
