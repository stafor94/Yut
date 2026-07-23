import assert from 'node:assert/strict';
import test from 'node:test';
import {
  QA_ROOM_LIMIT,
  USER_ROOM_LIMIT,
  classifyRoomKind,
  getRoomLimit,
  isRoomLimitReached,
  normalizeRoomTitleKey,
  resolveQaRoomContext,
} from '../../src/features/room/services/roomCapacityPolicy.js';

test('일반 방은 최대 3개, QA 방은 최대 8개로 제한한다', () => {
  assert.equal(USER_ROOM_LIMIT, 3);
  assert.equal(QA_ROOM_LIMIT, 8);
  assert.equal(getRoomLimit('user'), 3);
  assert.equal(getRoomLimit('qa'), 8);
  assert.equal(isRoomLimitReached('user', 2), false);
  assert.equal(isRoomLimitReached('user', 3), true);
  assert.equal(isRoomLimitReached('qa', 7), false);
  assert.equal(isRoomLimitReached('qa', 8), true);
});

test('QA 제목만으로는 QA 방으로 생성하지 않고 유효한 Run ID가 필요하다', () => {
  assert.equal(resolveQaRoomContext({
    title: 'QA-reg-room-abc12',
    runId: '',
    role: 'roll-movement',
  }), null);
  assert.equal(resolveQaRoomContext({
    title: 'QA-reg-room-abc12',
    runId: 'invalid-run',
    role: 'roll-movement',
  }), null);
  assert.equal(resolveQaRoomContext({
    title: '일반방',
    runId: 'gh-30000000000-1-roll-movement',
    role: 'roll-movement',
  }), null);
});

test('유효한 QA 컨텍스트는 Run ID와 역할을 정규화한다', () => {
  assert.deepEqual(resolveQaRoomContext({
    title: 'QA-reg-room-abc12',
    runId: 'GH-30000000000-1-ROLL-MOVEMENT',
    role: 'Roll-Movement',
  }), {
    runId: 'gh-30000000000-1-roll-movement',
    role: 'roll-movement',
  });
});

test('신규 필드와 레거시 필드 모두 QA 방을 식별한다', () => {
  assert.equal(classifyRoomKind({ roomKind: 'user', title: 'QA-legacy-room' }), 'user');
  assert.equal(classifyRoomKind({ roomKind: 'qa' }), 'qa');
  assert.equal(classifyRoomKind({ isQaRoom: true }), 'qa');
  assert.equal(classifyRoomKind({ qaRunId: 'gh-30000000000-1-roll-movement' }), 'qa');
  assert.equal(classifyRoomKind({ title: 'QA-legacy-room' }), 'qa');
  assert.equal(classifyRoomKind({ title: '일반방' }), 'user');
});

test('방 제목 비교 키는 앞뒤 공백과 대소문자를 정규화한다', () => {
  assert.equal(normalizeRoomTitleKey('  My Room  '), 'my room');
});
