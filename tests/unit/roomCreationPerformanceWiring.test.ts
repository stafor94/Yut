import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(path, 'utf8');

test('방 생성은 전체 만료 방 정리와 무제한 활성 방 조회를 임계 경로에서 사용하지 않는다', () => {
  const source = read('src/features/room/services/roomCreationService.ts');
  assert.doesNotMatch(source, /cleanupDeletionCandidatesBeforeCreate/);
  assert.doesNotMatch(source, /getActiveRoomSummaries/);
  assert.doesNotMatch(source, /getActiveRoomsWithPlayers/);
  assert.match(source, /getRoomDocumentsByKind/);
  assert.match(source, /getActiveHostRoomSummaries/);
});

test('기존 방 퇴장은 제한된 membership 조회 후 전역 생성 잠금 전에 완료한다', () => {
  const source = read('src/features/room/services/roomCreationService.ts');
  const membershipIndex = source.indexOf('const memberships = await getCappedActivePlayerRoomMemberships');
  const leaveIndex = source.indexOf('await leavePlayerRoomsBeforeCreate');
  const lockIndex = source.indexOf('await acquireRoomCreationLock');

  assert.ok(membershipIndex >= 0);
  assert.ok(leaveIndex > membershipIndex);
  assert.ok(lockIndex > leaveIndex);
});

test('최종 검증은 종류별 상한·호스트 방·중복 제목과 해당 호스트 player만 읽는다', () => {
  const source = read('src/features/room/services/roomCreationService.ts');
  assert.match(source, /getActiveHostRoomSummaries\(params\.hostId, now\)/);
  assert.match(source, /getRoomDocumentsByKind\(roomKind\)/);
  assert.match(source, /getDuplicateRoomTitleSummaries\(normalizedTitle, titleKey, now\)/);
  assert.match(source, /ownHostRooms\.map\(\(room\) => getRoomPlayer\(room\.id, params\.hostId\)\)/);
  assert.match(source, /isRoomLimitReached\(roomKind, capacityRooms\.length\)/);
});

test('종류별 상한 조회는 bounded equality query 뒤 실제 활성 인간 방만 포함한다', () => {
  const source = read('src/features/room/services/roomCapacityStore.ts');
  assert.match(source, /where\('roomKind', '==', roomKind\)/);
  assert.match(source, /where\('status', 'in', ACTIVE_ROOM_STATUSES\)/);
  assert.match(source, /firestoreLimit\(roomLimit \+ LEGACY_ROOM_SCAN_LIMIT\)/);
  assert.match(source, /filter\(\(room\) => hasActiveHumanRoomSummary\(room, now\)\)/);
});

test('로비 구독은 최근 활동 방과 최근 레거시 방을 bounded 조회한 뒤 대기·진행 방만 노출한다', () => {
  const source = read('src/features/room/services/roomListStore.ts');
  const activityOrderIndex = source.indexOf("orderBy('lastActivityAt', 'desc')");
  const activityLimitIndex = source.indexOf('limit(ROOM_LIST_QUERY_LIMIT)');
  const legacyOrderIndex = source.indexOf("orderBy('createdAt', 'desc')");
  const legacyLimitIndex = source.indexOf('limit(LEGACY_ROOM_SCAN_LIMIT)');

  assert.ok(activityOrderIndex >= 0);
  assert.ok(activityLimitIndex > activityOrderIndex);
  assert.ok(legacyOrderIndex >= 0);
  assert.ok(legacyLimitIndex > legacyOrderIndex);
  assert.match(source, /getDocs\(query\(/);
  assert.match(source, /room\.status === 'waiting' \|\| room\.status === 'playing'/);
  assert.doesNotMatch(source, /where\('status', 'in'/);
});

test('로비의 1시간 만료 정리는 createdAt 오래된 후보만 제한 조회하고 5분 주기로 반복한다', () => {
  const listSource = read('src/features/room/services/roomListStore.ts');
  const lifecycleStoreSource = read('src/features/room/services/roomLifecycleStore.ts');
  const cleanupStart = lifecycleStoreSource.indexOf('export async function cleanupExpiredRoomLifetimes');
  const cleanupEnd = lifecycleStoreSource.indexOf('export async function cleanupDeletionCandidatesBeforeCreate');
  const cleanupSource = lifecycleStoreSource.slice(cleanupStart, cleanupEnd);

  assert.match(listSource, /cleanupExpiredRoomLifetimes\(\)/);
  assert.match(listSource, /setInterval\(runLifetimeCleanup, ROOM_LIFETIME_CLEANUP_INTERVAL_MS\)/);
  assert.match(listSource, /clearInterval\(lifetimeCleanupTimer\)/);
  assert.match(cleanupSource, /where\('createdAt', '<=', cutoff\)/);
  assert.match(cleanupSource, /orderBy\('createdAt', 'asc'\)/);
  assert.match(cleanupSource, /firestoreLimit\(ROOM_LIFETIME_CLEANUP_LIMIT\)/);
  assert.doesNotMatch(cleanupSource, /getDocs\(collection\(db, 'rooms'\)\)/);
});

test('현재 방 구독은 수명 마감 시각에 맞춰 상태·기준 시각 guard와 함께 삭제를 요청한다', () => {
  const source = read('src/app/controllers/useRoomSummarySubscription.ts');
  assert.match(source, /getRoomLifetimeStartedAtMillis\(room\)/);
  assert.match(source, /getRoomLifetimeDeadlineMillis\(room\)/);
  assert.match(source, /setTimeout\(requestExpiredRoomDeletion, remainingMs \+ 1000\)/);
  assert.match(source, /expectedStatus: room\.status/);
  assert.match(source, /expectedLifetimeStartedAt: lifetimeStartedAt/);
  assert.match(source, /clearLifetimeTimer\(\)/);
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

test('신규 방 문서는 종류와 QA 식별 metadata를 생성 transaction에서 함께 기록한다', () => {
  const source = read('src/features/room/services/roomCreationService.ts');
  assert.match(source, /transaction\.set\(roomRef, \{[\s\S]*roomKind,[\s\S]*isQaRoom:/);
  assert.match(source, /qaRunId: qaContext\.runId/);
  assert.match(source, /qaRole: qaContext\.role/);
  assert.match(source, /qaCreatedAt: serverTimestamp\(\)/);
});

test('런타임 전역값만으로 production 방을 QA 방으로 우회할 수 없다', () => {
  const source = read('src/features/room/services/roomCreationService.ts');
  assert.match(source, /runId: BUILD_QA_RUN_ID/);
  assert.match(source, /runtimeRunId === BUILD_QA_RUN_ID\.toLowerCase\(\)/);
  assert.doesNotMatch(source, /runId: runtimeContext\?\.runId \?\? BUILD_QA_RUN_ID/);
});

test('기존 방 퇴장은 독립 room transaction을 병렬 실행한다', () => {
  const source = read('src/features/room/services/roomCreationCleanup.ts');
  assert.match(source, /await Promise\.all\(roomIds\.map/);
  assert.doesNotMatch(source, /for \(const roomId of roomIds\)/);
});
