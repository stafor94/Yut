import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(path, 'utf8');

test('명시적 퇴장은 방을 즉시 삭제하지 않고 서버 Timestamp로 유예를 시작한다', () => {
  const source = read('src/features/room/services/roomExitService.ts');
  assert.match(source, /emptySince:\s*serverTimestamp\(\)/);
  assert.match(source, /await reconcileRoomDeletionGrace\(roomId\)/);
  assert.doesNotMatch(source, /deleteRoomCore/);
  assert.match(source, /const hasFreshSeat = !freshPlayer\.isSpectator/);
});

test('방 목록 조회와 방 생성 정리는 waiting·playing·finished 방을 함께 검사한다', () => {
  const service = read('src/features/room/services/roomService.ts');
  const store = read('src/features/room/services/roomLifecycleStore.ts');
  assert.match(service, /cleanupDeletionCandidatesBeforeCreate\(\)/);
  assert.match(service, /where\('status', 'in', \['waiting', 'playing', 'finished'\]\)/);
  assert.match(service, /room\.status === 'finished' \|\| isRoomInGameCore\(room\)/);
  assert.match(store, /where\('status', 'in', \['waiting', 'playing', 'finished'\]\)/);
});

test('빈 방 정리는 브라우저 타이머가 아니라 절대 시각 reconciliation만 사용한다', () => {
  const service = read('src/features/room/services/roomService.ts');
  const scheduleFunction = service.slice(service.indexOf('export async function scheduleEmptyRoomDeletion'));
  assert.match(scheduleFunction, /reconcileRoomDeletionGrace\(roomId\)/);
  assert.doesNotMatch(scheduleFunction, /setTimeout/);
});

test('정상 종료 상태 자체는 재입장과 목록 표시를 차단하지 않고 만료 시각만 차단한다', () => {
  const join = read('src/features/room/services/roomJoinService.ts');
  const lifecycle = read('src/features/room/services/roomLifecyclePolicy.ts');
  const summaryFlow = read('src/app/flows/roomSummarySubscriptionFlow.ts');
  assert.match(join, /isRoomDeletionExpired\(room, Date\.now\(\)\)/);
  assert.match(join, /room\.status === 'finished' \|\| isRoomInGameCore\(room\)/);
  assert.doesNotMatch(lifecycle, /isRoomDeleting\(room\) \|\| room\.status === 'finished'/);
  assert.doesNotMatch(summaryFlow, /if \(room\.status === 'finished'\)/);
});

test('Firestore 규칙은 3분 절대 시각 만료와 만료 후 신규 입장 차단을 강제한다', () => {
  const rules = read('firestore.rules');
  assert.match(rules, /room\.emptySince \+ duration\.value\(3, 'm'\)/);
  assert.match(rules, /request\.resource\.data\.emptySince == request\.time/);
  assert.match(rules, /allow create: if signedIn\(\)\s*&& !hasExpiredEmptyGrace\(roomId\)/s);
});
