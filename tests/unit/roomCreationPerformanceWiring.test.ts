import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(path, 'utf8');

test('방 생성은 전체 만료 방 정리를 임계 경로에서 기다리지 않는다', () => {
  const source = read('src/features/room/services/roomCreationService.ts');
  assert.doesNotMatch(source, /cleanupDeletionCandidatesBeforeCreate/);
  assert.match(source, /getActiveRoomSummaries/);
  assert.doesNotMatch(source, /getActiveRoomsWithPlayers/);
});

test('기존 방 퇴장은 전역 생성 잠금을 획득하기 전에 완료한다', () => {
  const source = read('src/features/room/services/roomCreationService.ts');
  const membershipIndex = source.indexOf('const memberships = await getActivePlayerRoomMemberships');
  const leaveIndex = source.indexOf('await leavePlayerRoomsBeforeCreate');
  const lockIndex = source.indexOf('await acquireRoomCreationLock');

  assert.ok(membershipIndex >= 0);
  assert.ok(leaveIndex > membershipIndex);
  assert.ok(lockIndex > leaveIndex);
});

test('최종 검증은 방 요약과 해당 호스트 player 문서만 읽는다', () => {
  const source = read('src/features/room/services/roomCreationService.ts');
  assert.match(source, /await getActiveRoomSummaries\(now\)/);
  assert.match(source, /ownHostRooms\.map\(\(room\) => getRoomPlayer\(room\.id, params\.hostId\)\)/);
  assert.match(source, /hasActiveHumanRoomSummary\(room, now\)/);
});

test('성공 경로는 잠금 소유권과 방 ID를 transaction에서 재검증하고 잠금을 함께 해제한다', () => {
  const source = read('src/features/room/services/roomCreationService.ts');
  assert.match(source, /transaction\.get\(lockRef\)/);
  assert.match(source, /transaction\.get\(roomRef\)/);
  assert.match(source, /lock\.lockRequestId !== requestId \|\| lock\.lockOwnerToken !== ownerToken/);
  assert.match(source, /transaction\.set\(lockRef, \{[\s\S]*lockExpiresAt: 0/);
  assert.match(source, /lockReleasedWithRoomCommit = true/);
  assert.match(source, /if \(!lockReleasedWithRoomCommit\)/);
});

test('기존 방 퇴장은 독립 room transaction을 병렬 실행한다', () => {
  const source = read('src/features/room/services/roomCreationCleanup.ts');
  assert.match(source, /await Promise\.all\(roomIds\.map/);
  assert.doesNotMatch(source, /for \(const roomId of roomIds\)/);
});
