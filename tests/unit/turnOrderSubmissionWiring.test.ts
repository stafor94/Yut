import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(path, 'utf8');

test('순서 정하기 입력은 좌석별 독립 문서에 create-only로 저장한다', () => {
  const service = read('src/features/room/services/roomServiceCore.ts');
  const firestore = read('src/features/room/services/roomFirestore.ts');
  const rules = read('firestore.rules');

  assert.match(firestore, /turnOrderSubmissions/);
  assert.match(firestore, /sessionId.*roundId.*seatId/s);
  assert.match(service, /submitTurnOrderSubmission/);
  assert.match(service, /transaction\.get\(submissionRef\)/);
  assert.match(service, /transaction\.set\(submissionRef/);
  assert.match(rules, /match \/turnOrderSubmissions\/\{submissionId\}/);
  assert.match(rules, /allow update: if false/);
  assert.match(rules, /request\.resource\.data\.seatId == request\.auth\.uid/);
  assert.match(rules, /isGameCoordinator\(roomId\)/);
});

test('순서 정하기 입력 문서는 제품·QA·운영 삭제 경로에 포함된다', () => {
  const firestore = read('src/features/room/services/roomFirestore.ts');
  const qaRooms = read('tests/helpers/rooms.js');
  const maintenance = read('scripts/cleanup-production-room-backlog.mjs');

  assert.match(firestore, /ROOM_SUBCOLLECTIONS[\s\S]*turnOrderSubmissions/);
  assert.match(qaRooms, /roomSubcollections[\s\S]*turnOrderSubmissions/);
  assert.match(maintenance, /ROOM_SUBCOLLECTIONS[\s\S]*turnOrderSubmissions/);
});
